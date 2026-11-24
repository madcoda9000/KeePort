using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>
/// Holds temporary WebDAV uploads (for example KeePass2Android's <c>name.kdbx.tmp.12345678</c>)
/// until the client moves them onto the matching vault. Staged files never become vaults on their own.
/// </summary>
public sealed partial class WebDavStagingStore
{
    /// <summary>How long a staged upload is kept before it is discarded.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    /// <summary>The maximum number of staged uploads kept per WebDAV credential.</summary>
    public const int MaxEntriesPerCredential = 4;

    private readonly string _root;

    /// <summary>Initializes the store below the KeePort data directory.</summary>
    /// <param name="db">The SQLite store whose data directory hosts the staging folder.</param>
    public WebDavStagingStore(KeePortDb db)
    {
        _root = Path.Combine(db.DataDir, "webdav-staging");
    }

    /// <summary>Matches a temporary upload name and extracts the vault name it belongs to.</summary>
    /// <param name="name">The flat WebDAV file name from the request path.</param>
    /// <param name="targetName">The vault name the temporary upload will replace, if the name matches.</param>
    public static bool TryParseStagingName(string name, out string targetName)
    {
        var match = StagingNamePattern().Match(name);
        if (!match.Success)
        {
            targetName = string.Empty;
            return false;
        }
        targetName = match.Groups["target"].Success
            ? match.Groups["target"].Value
            : match.Groups["stem"].Value + match.Groups["ext"].Value;
        return true;
    }

    /// <summary>Stores a temporary upload for a credential and enforces the per-credential limit.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential that uploaded the file.</param>
    /// <param name="name">The temporary file name used by the client.</param>
    /// <param name="content">The encrypted KDBX bytes to stage.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    public async Task SaveAsync(string credentialId, string name, byte[] content, CancellationToken cancellationToken)
    {
        var directory = CredentialDirectory(credentialId);
        Directory.CreateDirectory(directory);
        PurgeExpired(directory);

        var path = EntryPath(credentialId, name);
        var tempPath = $"{path}.part-{Guid.NewGuid():N}";
        try
        {
            await File.WriteAllBytesAsync(tempPath, content, cancellationToken);
            File.Move(tempPath, path, overwrite: true);
        }
        catch
        {
            TryDelete(tempPath);
            throw;
        }

        var surplus = new DirectoryInfo(directory).GetFiles()
            .Where(/* Ignores partial writes of concurrent uploads.
             * <param name="f">A file in the credential's staging folder.</param>
             */ f => !f.Name.Contains(".part-", StringComparison.Ordinal))
            .OrderByDescending(/* Orders staged uploads newest first.
             * <param name="f">A staged upload file.</param>
             */ f => f.LastWriteTimeUtc)
            .Skip(MaxEntriesPerCredential);
        foreach (var file in surplus)
        {
            TryDelete(file.FullName);
        }
    }

    /// <summary>Reads a staged upload, or returns null if it is missing or expired.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential that uploaded the file.</param>
    /// <param name="name">The temporary file name used by the client.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    public async Task<byte[]?> ReadAsync(string credentialId, string name, CancellationToken cancellationToken)
    {
        var path = EntryPath(credentialId, name);
        if (!File.Exists(path))
        {
            return null;
        }
        if (DateTime.UtcNow - File.GetLastWriteTimeUtc(path) > Lifetime)
        {
            TryDelete(path);
            return null;
        }
        return await File.ReadAllBytesAsync(path, cancellationToken);
    }

    /// <summary>Removes a staged upload and reports whether one existed.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential that uploaded the file.</param>
    /// <param name="name">The temporary file name used by the client.</param>
    public bool Delete(string credentialId, string name)
    {
        var path = EntryPath(credentialId, name);
        var existed = File.Exists(path);
        TryDelete(path);
        return existed;
    }

    /// <summary>Removes staged uploads in a credential folder that are older than the lifetime.</summary>
    /// <param name="directory">The credential's staging folder.</param>
    private static void PurgeExpired(string directory)
    {
        foreach (var file in new DirectoryInfo(directory).GetFiles())
        {
            if (DateTime.UtcNow - file.LastWriteTimeUtc > Lifetime)
            {
                TryDelete(file.FullName);
            }
        }
    }

    /// <summary>Builds the staging folder of a credential from a hash of its ID.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential.</param>
    private string CredentialDirectory(string credentialId) => Path.Combine(_root, Hash(credentialId));

    /// <summary>Builds the on-disk path of a staged upload from a hash of its name, so client input never reaches the file system.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential.</param>
    /// <param name="name">The temporary file name used by the client.</param>
    private string EntryPath(string credentialId, string name)
        => Path.Combine(CredentialDirectory(credentialId), Hash(name.ToLowerInvariant()));

    /// <summary>Returns the lowercase hexadecimal SHA-256 of a text value.</summary>
    /// <param name="value">The text to hash.</param>
    private static string Hash(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    /// <summary>Deletes a file if it exists and ignores cleanup errors.</summary>
    /// <param name="path">The file to remove.</param>
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

    /// <summary>
    /// Matches the temporary names KeePass2Android versions use: <c>&lt;vault&gt;.kdbx.tmp.&lt;suffix&gt;</c>
    /// (current source) and <c>&lt;stem&gt;_tmp_&lt;suffix&gt;.kdbx</c> (released apps), each with a short alphanumeric suffix.
    /// </summary>
    [GeneratedRegex(@"^(?:(?<target>.+\.kdbx)\.tmp\.[0-9A-Za-z]{1,64}|(?<stem>.+)_tmp_[0-9A-Za-z]{1,64}(?<ext>\.kdbx))$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex StagingNamePattern();
}
