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

public sealed record VaultWriteResult(VaultWriteStatus Status, VaultFileRecord? File, string? CurrentETag);

public sealed class VaultService
{
    internal const string ConflictCopyMessage = "The vault changed on the server. Your submitted version was saved as a conflict copy for an administrator.";
    private const int MaxNameLength = 200;

    private readonly KeePortDb _db;
    private readonly SemaphoreSlim[] _writeLocks = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    public VaultService(KeePortDb db)
    {
        _db = db;
    }

    public IReadOnlyList<VaultFileRecord> ListForUser(UserRecord user) => _db.ListVaultFilesForUser(user);

    public IReadOnlyList<VaultFileRecord> ListAll(bool includeDeleted) => _db.ListAllVaultFiles(includeDeleted);

    public VaultFileRecord? Get(string id, bool includeDeleted = false) => _db.GetVaultFile(id, includeDeleted);

    public VaultFileRecord? GetByName(string name) => _db.GetVaultFileByName(name);

    public string GetContentPath(VaultFileRecord file) => Path.Combine(_db.VaultDirectory, file.StoredName);

    public async Task<byte[]?> ReadContentAsync(VaultFileRecord file, CancellationToken cancellationToken = default)
    {
        var path = GetContentPath(file);
        if (!File.Exists(path))
        {
            return null;
        }
        return await File.ReadAllBytesAsync(path, cancellationToken);
    }

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

    public bool CanRead(UserRecord user, VaultFileRecord file) => GetEffectivePermission(user, file) is "read" or "read-write";

    public bool CanWrite(UserRecord user, VaultFileRecord file) => GetEffectivePermission(user, file) == "read-write";

    /// <summary>Stores encrypted content as a new vault without assigning any permissions.</summary>
    public async Task<VaultFileRecord> CreateAsync(string name, byte[] content, UserRecord user, CancellationToken cancellationToken)
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
        return record;
    }

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

    public void SoftDelete(VaultFileRecord file) => _db.SoftDeleteVaultFile(file.Id);

    public void Restore(VaultFileRecord file) => _db.RestoreVaultFile(file.Id);

    /// <summary>Checks the latest revision under a write lock and saves stale submissions as separate vaults.</summary>
    public async Task<VaultWriteResult> WriteContentAsync(
        string fileId,
        byte[] content,
        string? expectedETag,
        UserRecord user,
        string client,
        CancellationToken cancellationToken)
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
                await CreateAsync(ConflictCopyName(file.Name, client), content, user, cancellationToken);
                return new VaultWriteResult(VaultWriteStatus.Conflict, file, file.ETag);
            }

            ValidateKdbxContent(content);
            var path = GetContentPath(file);
            Directory.CreateDirectory(_db.VaultDirectory);
            await WriteAtomicAsync(path, content, cancellationToken);

            var sha256 = ComputeSha256(content);
            var revision = file.Revision + 1;
            var etag = BuildETag(sha256, revision);
            _db.UpdateVaultFileContent(file.Id, content.LongLength, sha256, revision, etag, user.Id);

            var updated = file with
            {
                Size = content.LongLength,
                Sha256 = sha256,
                Revision = revision,
                ETag = etag,
                UpdatedAt = DateTimeOffset.UtcNow,
                UpdatedBy = user.Id
            };
            return new VaultWriteResult(VaultWriteStatus.Success, updated, null);
        }
        finally
        {
            writeLock.Release();
        }
    }

    /// <summary>Builds a unique, valid display name for a conflict copy.</summary>
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

    public IReadOnlyList<VaultPermissionRecord> ListPermissions(string fileId) => _db.ListPermissionsForFile(fileId);

    public void ReplacePermissions(string fileId, IEnumerable<(string UserId, VaultPermission Permission)> permissions)
        => _db.ReplacePermissionsForFile(fileId, permissions);

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

    public static string BuildETag(string sha256, long revision) => $"\"{sha256}-{revision}\"";

    public static string NormalizeETag(string etag)
    {
        var value = etag.Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal))
        {
            value = value[2..];
        }
        return value.Trim('"');
    }

    public static bool ETagMatches(string expected, string actual)
    {
        var normalizedExpected = NormalizeETag(expected);
        var normalizedActual = NormalizeETag(actual);
        return string.Equals(normalizedExpected, normalizedActual, StringComparison.Ordinal) ||
               string.Equals(expected.Trim(), "*", StringComparison.Ordinal);
    }

    public static bool HasKdbxSignature(ReadOnlySpan<byte> content)
        => content.Length >= 4 && content[0] == 0x03 && content[1] == 0xD9 && content[2] == 0xA2 && content[3] == 0x9A;

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

    private static string ComputeSha256(byte[] content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

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

public sealed class VaultValidationException(string message) : Exception(message);

public sealed class VaultConflictException(string message) : Exception(message);
