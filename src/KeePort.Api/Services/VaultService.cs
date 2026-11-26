using System.Globalization;
using System.Security.Cryptography;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

public enum VaultWriteStatus
{
    Success,
    PreconditionRequired,
    NotFound,
    Forbidden,
    Conflict
}

/// <summary>Describes a vault write outcome and the relevant file metadata or current ETag.</summary>
/// <param name="Status">The result status of the attempted write.</param>
/// <param name="File">The saved vault or conflict copy, if the operation produced one.</param>
/// <param name="CurrentETag">The current file entity tag, if known.</param>
public sealed record VaultWriteResult(VaultWriteStatus Status, VaultFileRecord? File, string? CurrentETag);

public sealed class VaultService
{
    internal const string ConflictCopyMessage = "The vault changed on the server. Your submitted version was saved as a conflict copy for an administrator.";
    private const int MaxNameLength = 200;

    private readonly KeePortDb _db;
    private readonly SemaphoreSlim[] _writeLocks = Enumerable.Range(0, 64).Select(/* Creates one semaphore for each striped write-lock bucket.
     * <param name="_">The bucket index, unused because each bucket gets an identical semaphore.</param>
     */ _ => new SemaphoreSlim(1, 1)).ToArray();

    /// <summary>Initializes the vault service with its metadata store.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    public VaultService(KeePortDb db)
    {
        _db = db;
    }

    /// <summary>Lists active vaults and their permissions for the given user.</summary>
    /// <param name="user">The user account associated with the operation.</param>
    public IReadOnlyList<VaultFileRecord> ListForUser(UserRecord user) => _db.ListVaultFilesForUser(user);

    /// <summary>Lists vault metadata for administration, optionally including deleted files.</summary>
    /// <param name="includeDeleted">Whether to include soft-deleted vaults.</param>
    public IReadOnlyList<VaultFileRecord> ListAll(bool includeDeleted) => _db.ListAllVaultFiles(includeDeleted);

    /// <summary>Finds a vault by ID with optional inclusion of deleted records.</summary>
    /// <param name="id">The vault file ID.</param>
    /// <param name="includeDeleted">Whether to include soft-deleted vaults.</param>
    public VaultFileRecord? Get(string id, bool includeDeleted = false) => _db.GetVaultFile(id, includeDeleted);

    /// <summary>Finds an active vault by its display name.</summary>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    public VaultFileRecord? GetByName(string name) => _db.GetVaultFileByName(name);

    /// <summary>Resolves the encrypted file path from the vault's stored filename.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    public string GetContentPath(VaultFileRecord file) => Path.Combine(_db.VaultDirectory, file.StoredName);

    /// <summary>Reads the encrypted bytes or returns null if the stored file is missing.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    public async Task<byte[]?> ReadContentAsync(VaultFileRecord file, CancellationToken cancellationToken = default)
    {
        var path = GetContentPath(file);
        if (!File.Exists(path))
        {
            return null;
        }
        return await File.ReadAllBytesAsync(path, cancellationToken);
    }

    /// <summary>Resolves access from the administrator role or the user's explicit vault grant.</summary>
    /// <param name="user">The account whose role or vault grant determines access.</param>
    /// <param name="file">The vault whose access grant is being evaluated.</param>
    public string GetEffectivePermission(UserRecord user, VaultFileRecord file)
    {
        if (user.Role == UserRole.Admin)
        {
            return "read-write";
        }

        var permission = _db.GetPermission(user.Id, file.Id)?.Permission;
        return permission switch
        {
            VaultPermission.ReadWrite => "read-write",
            VaultPermission.Read => "read",
            _ => "none"
        };
    }

    /// <summary>Checks whether the user can read the vault.</summary>
    /// <param name="user">The user account associated with the operation.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    public bool CanRead(UserRecord user, VaultFileRecord file) => GetEffectivePermission(user, file) is "read" or "read-write";

    /// <summary>Checks whether the user can modify the vault.</summary>
    /// <param name="user">The user account associated with the operation.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    public bool CanWrite(UserRecord user, VaultFileRecord file) => GetEffectivePermission(user, file) == "read-write";

    /// <summary>Stores encrypted content as a new vault without assigning any permissions.</summary>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    /// <param name="content">The encrypted file bytes to validate or write.</param>
    /// <param name="user">The account recorded as the vault creator.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    /// <param name="source">How the vault was created, e.g. "Upload" or "Conflict copy", for the version list.</param>
    public async Task<VaultFileRecord> CreateAsync(string name, byte[] content, UserRecord user, CancellationToken cancellationToken, string source = "Upload")
    {
        var cleanName = ValidateName(name);
        ValidateKdbxContent(content);
        if (_db.GetVaultFileByName(cleanName) is not null)
        {
            throw new VaultConflictException("A vault with this name already exists.");
        }

        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid().ToString("N");
        var sha256 = ComputeSha256(content);
        var record = new VaultFileRecord
        {
            Id = id,
            Name = cleanName,
            StoredName = $"{id}.kdbx",
            Size = content.LongLength,
            Sha256 = sha256,
            Revision = 1,
            ETag = BuildETag(sha256, 1),
            CreatedAt = now,
            UpdatedAt = now,
            CreatedBy = user.Id,
            UpdatedBy = user.Id,
            Permission = "read-write"
        };

        var path = GetContentPath(record);
        Directory.CreateDirectory(_db.VaultDirectory);
        await WriteAtomicAsync(path, content, cancellationToken);
        try
        {
            _db.CreateVaultFile(record);
        }
        catch
        {
            TryDelete(path);
            throw;
        }
        _db.RecordRevision(new VaultRevisionRecord(record.Id, 1, record.Size, sha256, now, user.Id, user.Username, source, Archived: false));
        return record;
    }

    /// <summary>Validates a vault's new name, checks uniqueness, and records the rename.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    /// <param name="user">The account whose ID is stored as the last updater.</param>
    public VaultFileRecord Rename(VaultFileRecord file, string name, UserRecord user)
    {
        var cleanName = ValidateName(name);
        var existing = _db.GetVaultFileByName(cleanName);
        if (existing is not null && !string.Equals(existing.Id, file.Id, StringComparison.Ordinal))
        {
            throw new VaultConflictException("A vault with this name already exists.");
        }

        _db.RenameVaultFile(file.Id, cleanName, user.Id);
        return file with { Name = cleanName, UpdatedAt = DateTimeOffset.UtcNow };
    }

    /// <summary>Marks the vault as deleted without removing the encrypted file.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    public void SoftDelete(VaultFileRecord file) => _db.SoftDeleteVaultFile(file.Id);

    /// <summary>Clears the vault's soft-deletion marker.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    public void Restore(VaultFileRecord file) => _db.RestoreVaultFile(file.Id);

    /// <summary>Checks the latest revision under a write lock and saves stale submissions as separate vaults.</summary>
    /// <param name="fileId">The ID of the vault file.</param>
    /// <param name="content">The encrypted file bytes to validate or write.</param>
    /// <param name="expectedETag">The entity tag supplied as a write precondition, or null if none was supplied.</param>
    /// <param name="user">The account recorded as the writer of the revision or conflict copy.</param>
    /// <param name="client">The source label used to identify any conflict copy created for this write.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    /// <param name="source">How the content was saved, e.g. "Web vault" or "WebDAV · Pixel 8", for the version list.</param>
    /// <exception cref="VaultVersionException">The current content could not be kept as a version; nothing was saved.</exception>
    public async Task<VaultWriteResult> WriteContentAsync(
        string fileId,
        byte[] content,
        string? expectedETag,
        UserRecord user,
        string client,
        CancellationToken cancellationToken,
        string? source = null)
    {
        var writeLock = _writeLocks[(uint)StringComparer.Ordinal.GetHashCode(fileId) % _writeLocks.Length];
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var file = Get(fileId);
            if (file is null)
            {
                return new VaultWriteResult(VaultWriteStatus.NotFound, null, null);
            }
            if (!CanWrite(user, file))
            {
                return new VaultWriteResult(VaultWriteStatus.Forbidden, null, null);
            }
            if (string.IsNullOrWhiteSpace(expectedETag))
            {
                return new VaultWriteResult(VaultWriteStatus.PreconditionRequired, file, file.ETag);
            }
            if (!ETagMatches(expectedETag, file.ETag))
            {
                await CreateAsync(ConflictCopyName(file.Name, client), content, user, cancellationToken, "Conflict copy");
                return new VaultWriteResult(VaultWriteStatus.Conflict, file, file.ETag);
            }

            ValidateKdbxContent(content);
            var updated = await ReplaceContentLockedAsync(file, content, user, source ?? client, cancellationToken);
            return new VaultWriteResult(VaultWriteStatus.Success, updated, null);
        }
        finally
        {
            writeLock.Release();
        }
    }

    /// <summary>
    /// Replaces a vault's content while its write lock is held: keeps the current content as an earlier version (when
    /// versions are on), writes the new content atomically and records the new revision.
    /// </summary>
    /// <param name="file">The vault as it is now.</param>
    /// <param name="content">The validated new encrypted content.</param>
    /// <param name="user">The account that saves.</param>
    /// <param name="source">How the content was saved, for the version list.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <exception cref="VaultVersionException">The current content could not be kept; nothing was saved.</exception>
    private async Task<VaultFileRecord> ReplaceContentLockedAsync(VaultFileRecord file, byte[] content, UserRecord user, string source, CancellationToken cancellationToken)
    {
        var (maxCount, _) = _db.GetVersionSettings();
        if (maxCount > 0)
        {
            await ArchiveCurrentAsync(file, cancellationToken);
        }

        var path = GetContentPath(file);
        Directory.CreateDirectory(_db.VaultDirectory);
        await WriteAtomicAsync(path, content, cancellationToken);

        var sha256 = ComputeSha256(content);
        var revision = file.Revision + 1;
        var etag = BuildETag(sha256, revision);
        var now = DateTimeOffset.UtcNow;
        _db.UpdateVaultFileContent(file.Id, content.LongLength, sha256, revision, etag, user.Id);
        _db.RecordRevision(new VaultRevisionRecord(file.Id, revision, content.LongLength, sha256, now, user.Id, user.Username, source, Archived: false));
        PruneVersions(file.Id);

        return file with
        {
            Size = content.LongLength,
            Sha256 = sha256,
            Revision = revision,
            ETag = etag,
            UpdatedAt = now,
            UpdatedBy = user.Id
        };
    }

    /// <summary>The folder that holds the kept earlier versions, one subfolder per vault.</summary>
    public string VersionDirectory => Path.Combine(_db.DataDir, "vault-versions");

    /// <summary>Returns the file path of one kept version.</summary>
    /// <param name="fileId">The vault's ID.</param>
    /// <param name="revision">The revision number.</param>
    public string GetVersionPath(string fileId, long revision)
        => Path.Combine(VersionDirectory, fileId, revision.ToString(CultureInfo.InvariantCulture) + ".kdbx");

    /// <summary>
    /// Copies the current content into the version folder and marks the revision as kept. Copying, not moving, keeps the
    /// vault readable the whole time. A failure is reported as <see cref="VaultVersionException"/>.
    /// </summary>
    /// <param name="file">The vault as it is now.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    private async Task ArchiveCurrentAsync(VaultFileRecord file, CancellationToken cancellationToken)
    {
        var target = GetVersionPath(file.Id, file.Revision);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            var content = await File.ReadAllBytesAsync(GetContentPath(file), cancellationToken);
            await WriteAtomicAsync(target, content, cancellationToken);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new VaultVersionException("The previous version could not be kept, so nothing was saved. Check the free disk space on the server.", ex);
        }

        var known = _db.GetRevision(file.Id, file.Revision);
        _db.RecordRevision(known is null
            ? new VaultRevisionRecord(file.Id, file.Revision, file.Size, file.Sha256, file.UpdatedAt, file.UpdatedBy,
                file.UpdatedBy is null ? null : _db.GetUserById(file.UpdatedBy)?.Username, null, Archived: true)
            : known with { Archived = true });
    }

    /// <summary>Lists the current revision and the kept earlier versions of a vault, newest first.</summary>
    /// <param name="file">The vault.</param>
    public VaultVersionsDto ListVersions(VaultFileRecord file)
    {
        var current = _db.GetRevision(file.Id, file.Revision);
        var currentDto = new VaultVersionDto(file.Revision, file.Size, current?.SavedAt ?? file.UpdatedAt,
            current?.SavedByName ?? (file.UpdatedBy is null ? null : _db.GetUserById(file.UpdatedBy)?.Username), current?.Source);
        var versions = _db.ListArchivedRevisions(file.Id)
            .Where(/* Only versions whose file still exists. */ r => File.Exists(GetVersionPath(file.Id, r.Revision)))
            .Select(/* Converts one record. */ r => new VaultVersionDto(r.Revision, r.Size, r.SavedAt, r.SavedByName, r.Source))
            .ToList();
        return new VaultVersionsDto(currentDto, versions);
    }

    /// <summary>
    /// Restores an earlier version as a new revision: the old content is saved on top, so every KeePass app sees a new
    /// ETag and reloads, and the state before the restore stays available as a version.
    /// </summary>
    /// <param name="fileId">The vault's ID.</param>
    /// <param name="revision">The earlier revision to restore.</param>
    /// <param name="user">The administrator who restores.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <returns>The vault after the restore, or null when the vault or version does not exist.</returns>
    /// <exception cref="VaultVersionException">The current content could not be kept; nothing was changed.</exception>
    public async Task<VaultFileRecord?> RestoreVersionAsync(string fileId, long revision, UserRecord user, CancellationToken cancellationToken)
    {
        var writeLock = _writeLocks[(uint)StringComparer.Ordinal.GetHashCode(fileId) % _writeLocks.Length];
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var file = Get(fileId);
            var path = GetVersionPath(fileId, revision);
            if (file is null || revision >= file.Revision || !File.Exists(path))
            {
                return null;
            }
            var content = await File.ReadAllBytesAsync(path, cancellationToken);
            ValidateKdbxContent(content);
            return await ReplaceContentLockedAsync(file, content, user, $"Restore of revision {revision.ToString(CultureInfo.InvariantCulture)}", cancellationToken);
        }
        finally
        {
            writeLock.Release();
        }
    }

    /// <summary>
    /// Deletes kept versions of one vault beyond the configured count or age; with versions turned off, all of them.
    /// </summary>
    /// <param name="fileId">The vault's ID.</param>
    public void PruneVersions(string fileId)
    {
        var (maxCount, maxDays) = _db.GetVersionSettings();
        var cutoff = maxDays > 0 ? DateTimeOffset.UtcNow.AddDays(-maxDays) : DateTimeOffset.MinValue;
        var kept = 0;
        foreach (var version in _db.ListArchivedRevisions(fileId))
        {
            if (kept < maxCount && version.SavedAt >= cutoff)
            {
                kept++;
                continue;
            }
            TryDelete(GetVersionPath(fileId, version.Revision));
            _db.DeleteRevision(fileId, version.Revision);
        }
    }

    /// <summary>Applies the retention to the kept versions of every vault, e.g. daily and after a settings change.</summary>
    public void PruneAllVersions()
    {
        foreach (var fileId in _db.ListFilesWithArchivedRevisions())
        {
            PruneVersions(fileId);
        }
    }

    /// <summary>Builds a unique, valid display name for a conflict copy.</summary>
    /// <param name="original">The original vault filename used to derive the conflict-copy name.</param>
    /// <param name="client">The client source label to include in the conflict-copy name.</param>
    private static string ConflictCopyName(string original, string client)
    {
        var timestamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd'T'HHmmssfff'Z'", CultureInfo.InvariantCulture);
        var suffix = $".conflict-{timestamp}-{client}-{Guid.NewGuid():N}.kdbx";
        var stem = original[..Math.Min(original.Length - ".kdbx".Length, MaxNameLength - suffix.Length)];
        if (stem.Length > 0 && char.IsHighSurrogate(stem[^1]))
        {
            stem = stem[..^1];
        }
        return stem.TrimEnd('.') + suffix;
    }

    /// <summary>Lists the explicit user permissions for the specified vault.</summary>
    /// <param name="fileId">The ID of the vault file.</param>
    public IReadOnlyList<VaultPermissionRecord> ListPermissions(string fileId) => _db.ListPermissionsForFile(fileId);

    /// <summary>Replaces the specified vault's access list with the supplied grants.</summary>
    /// <param name="fileId">The ID of the vault file.</param>
    /// <param name="permissions">The full set of user IDs and grants to store in place of the existing access list.</param>
    public void ReplacePermissions(string fileId, IEnumerable<(string UserId, VaultPermission Permission)> permissions)
        => _db.ReplacePermissionsForFile(fileId, permissions);

    /// <summary>Validates and normalizes the display name for a KDBX file.</summary>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    public static string ValidateName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new VaultValidationException("Vault name is required.");
        }

        var clean = name.Trim();
        if (clean.Length > MaxNameLength)
        {
            throw new VaultValidationException("Vault name is too long.");
        }
        if (!clean.EndsWith(".kdbx", StringComparison.OrdinalIgnoreCase))
        {
            throw new VaultValidationException("Vault files must use the .kdbx extension.");
        }
        if (clean.Contains('/') || clean.Contains('\\') || clean.Contains("..", StringComparison.Ordinal) || clean.Any(char.IsControl))
        {
            throw new VaultValidationException("Vault name contains invalid characters.");
        }
        return clean;
    }

    /// <summary>Builds the quoted ETag from the file checksum and revision number.</summary>
    /// <param name="sha256">The hexadecimal SHA-256 checksum of the encrypted bytes.</param>
    /// <param name="revision">The revision number of the file content.</param>
    public static string BuildETag(string sha256, long revision) => $"\"{sha256}-{revision}\"";

    /// <summary>Trims whitespace and the weak prefix from an ETag before comparison.</summary>
    /// <param name="etag">The raw entity tag to normalize before comparing it.</param>
    public static string NormalizeETag(string etag)
    {
        var value = etag.Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal))
        {
            value = value[2..];
        }
        return value.Trim('"');
    }

    /// <summary>Compares the normalized supplied ETag or wildcard with the current file ETag.</summary>
    /// <param name="expected">The precondition ETag or wildcard supplied by the client.</param>
    /// <param name="actual">The current server-side ETag of the vault.</param>
    public static bool ETagMatches(string expected, string actual)
    {
        var normalizedExpected = NormalizeETag(expected);
        var normalizedActual = NormalizeETag(actual);
        return string.Equals(normalizedExpected, normalizedActual, StringComparison.Ordinal) ||
               string.Equals(expected.Trim(), "*", StringComparison.Ordinal);
    }

    /// <summary>Checks that the payload starts with the KDBX magic bytes.</summary>
    /// <param name="content">The encrypted file bytes to validate or write.</param>
    public static bool HasKdbxSignature(ReadOnlySpan<byte> content)
        => content.Length >= 4 && content[0] == 0x03 && content[1] == 0xD9 && content[2] == 0xA2 && content[3] == 0x9A;

    /// <summary>Rejects empty uploads or payloads without the KDBX signature.</summary>
    /// <param name="content">The encrypted file bytes to validate or write.</param>
    private static void ValidateKdbxContent(byte[] content)
    {
        if (content.Length == 0)
        {
            throw new VaultValidationException("KDBX file is empty.");
        }
        if (!HasKdbxSignature(content))
        {
            throw new VaultValidationException("File does not have a valid KDBX signature.");
        }
    }

    /// <summary>Computes the SHA-256 checksum as lowercase hexadecimal text.</summary>
    /// <param name="content">The bytes to hash.</param>
    private static string ComputeSha256(byte[] content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

    /// <summary>Flushes encrypted content to a temporary file and atomically moves it into place.</summary>
    /// <param name="path">The target file path to replace after writing the temporary file.</param>
    /// <param name="content">The encrypted file bytes to validate or write.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private async Task WriteAtomicAsync(string path, byte[] content, CancellationToken cancellationToken)
    {
        var tempPath = $"{path}.tmp-{Guid.NewGuid():N}";
        try
        {
            await using (var stream = new FileStream(
                tempPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                FileOptions.WriteThrough | FileOptions.Asynchronous))
            {
                await stream.WriteAsync(content, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                stream.Flush(true);
            }
            File.Move(tempPath, path, overwrite: true);
        }
        catch
        {
            TryDelete(tempPath);
            throw;
        }
    }

    /// <summary>Attempts to delete a file during cleanup without masking the original failure.</summary>
    /// <param name="path">The cleanup path whose file should be removed if it exists.</param>
    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Best-effort cleanup only.
        }
    }
}

/// <summary>Indicates that a vault name or its submitted bytes failed validation.</summary>
/// <param name="message">The human-readable description of the failure.</param>
public sealed class VaultValidationException(string message) : Exception(message);

/// <summary>Indicates that the current content of a vault could not be kept as a version, so nothing was saved.</summary>
/// <param name="message">The human-readable description of the failure.</param>
/// <param name="inner">The file system error.</param>
public sealed class VaultVersionException(string message, Exception inner) : Exception(message, inner);

/// <summary>Indicates that a vault operation conflicts with existing state.</summary>
/// <param name="message">The human-readable description of the failure.</param>
public sealed class VaultConflictException(string message) : Exception(message);
