using System.Security.Cryptography;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

public enum VaultWriteStatus
{
    Success,
    PreconditionRequired,
    Conflict
}

public sealed record VaultWriteResult(VaultWriteStatus Status, VaultFileRecord? File, string? CurrentETag);

public sealed class VaultService
{
    private readonly KeePortDb _db;

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

    public VaultFileRecord Create(string name, byte[] content, UserRecord user)
    {
        var cleanName = ValidateName(name);
        if (content.Length == 0)
        {
            throw new VaultValidationException("KDBX file is empty.");
        }
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
        WriteAtomic(path, content);
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

    public async Task<VaultWriteResult> WriteContentAsync(
        VaultFileRecord file,
        byte[] content,
        string? expectedETag,
        UserRecord user,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(expectedETag))
        {
            return new VaultWriteResult(VaultWriteStatus.PreconditionRequired, file, file.ETag);
        }

        if (!ETagMatches(expectedETag, file.ETag))
        {
            return new VaultWriteResult(VaultWriteStatus.Conflict, file, file.ETag);
        }

        if (content.Length == 0)
        {
            throw new VaultValidationException("KDBX file is empty.");
        }

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
        if (clean.Length > 200)
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

    private static string ComputeSha256(byte[] content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

    private async Task WriteAtomicAsync(string path, byte[] content, CancellationToken cancellationToken)
    {
        var tempPath = $"{path}.tmp-{Guid.NewGuid():N}";
        try
        {
            await using var stream = new FileStream(
                tempPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                FileOptions.WriteThrough | FileOptions.Asynchronous);
            await stream.WriteAsync(content, cancellationToken);
            await stream.FlushAsync(cancellationToken);
            stream.Flush(true);
        }
        catch
        {
            TryDelete(tempPath);
            throw;
        }

        File.Move(tempPath, path, overwrite: true);
    }

    private void WriteAtomic(string path, byte[] content) => WriteAtomicAsync(path, content, CancellationToken.None).GetAwaiter().GetResult();

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
