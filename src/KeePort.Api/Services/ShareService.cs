using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>The administrator's sharing rules.</summary>
/// <param name="Mode">off (nobody), all (every user unless blocked) or selected (only users marked as allowed).</param>
/// <param name="MaxDays">The longest a share may stay valid, in days.</param>
/// <param name="MaxViews">The most views a share may allow.</param>
/// <param name="RequirePassword">Whether every share needs a password for the recipient.</param>
/// <param name="AllowEmail">Whether KeePort may e-mail the link to the recipient (a recipient password is then required).</param>
/// <param name="AllowEmailCode">Whether the recipient may be asked to confirm their address with a code.</param>
public sealed record ShareSettings(string Mode, int MaxDays, int MaxViews, bool RequirePassword, bool AllowEmail, bool AllowEmailCode)
{
    /// <summary>The settings before an administrator changed anything: sharing is off.</summary>
    public static readonly ShareSettings Default = new("off", 7, 5, false, false, false);
}

/// <summary>
/// The rules and checks of sharing: who may share, from which vault, with which limits, and the format of the
/// encrypted data the browser sends. The server never sees the key; it only stores ciphertext and a hash of an access
/// proof derived from the key.
/// </summary>
/// <param name="db">The SQLite store for KeePort metadata.</param>
public sealed partial class ShareService(KeePortDb db)
{
    private const string SettingsKey = "share_settings";

    /// <summary>How many wrong passwords or codes lock a share for good.</summary>
    public const int MaxFailedAttempts = 10;

    /// <summary>How many e-mail codes one share may send.</summary>
    public const int MaxCodes = 5;

    /// <summary>Days the metadata of an ended share is kept for the lists.</summary>
    public const int KeepEndedDays = 30;

    /// <summary>The largest encrypted secret accepted, in Base64 characters.</summary>
    public const int MaxCiphertextLength = 256 * 1024;

    /// <summary>The longest label.</summary>
    public const int MaxLabelLength = 100;

    /// <summary>Reads the current settings.</summary>
    public ShareSettings GetSettings()
    {
        var json = db.GetState(SettingsKey);
        if (json is null)
        {
            return ShareSettings.Default;
        }
        try
        {
            return JsonSerializer.Deserialize<ShareSettings>(json) ?? ShareSettings.Default;
        }
        catch (JsonException)
        {
            return ShareSettings.Default;
        }
    }

    /// <summary>Checks and stores new settings; returns an error text, or null when they were saved.</summary>
    /// <param name="settings">The new settings.</param>
    public string? SaveSettings(ShareSettings settings)
    {
        if (settings.Mode is not ("off" or "all" or "selected"))
        {
            return "Sharing must be off, all or selected.";
        }
        if (settings.MaxDays is < 1 or > 30)
        {
            return "The longest validity must be between 1 and 30 days.";
        }
        if (settings.MaxViews is < 1 or > 20)
        {
            return "The most views must be between 1 and 20.";
        }
        db.SetState(SettingsKey, JsonSerializer.Serialize(settings));
        return null;
    }

    /// <summary>Tells whether an account may share at all, from the global mode and its own override.</summary>
    /// <param name="user">The account.</param>
    public bool MayShare(UserRecord user)
    {
        if (user.Disabled || user.Role != UserRole.User)
        {
            return false;
        }
        var settings = GetSettings();
        if (settings.Mode == "off")
        {
            return false;
        }
        var mode = db.GetShareUserOverride(user.Id);
        return mode == "allowed" || (mode != "blocked" && settings.Mode == "all");
    }

    /// <summary>Tells whether entries of a vault may be shared.</summary>
    /// <param name="vaultFileId">The vault's ID.</param>
    public bool VaultAllowsSharing(string vaultFileId) => !db.ListShareVaultBlocks().Contains(vaultFileId);

    /// <summary>Creates a random share ID with 128 bits, Base64url.</summary>
    public static string NewId() => Base64Url(RandomNumberGenerator.GetBytes(16));

    /// <summary>Creates a random six-digit e-mail code.</summary>
    public static string NewCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Hashes an access proof (Base64url of 32 bytes) for storage; returns null when it is malformed.</summary>
    /// <param name="proof">The proof the browser derived from the key and the optional password.</param>
    public static string? HashProof(string? proof)
    {
        var bytes = DecodeBase64Url(proof);
        return bytes is { Length: 32 } ? Convert.ToHexString(SHA256.HashData(bytes)) : null;
    }

    /// <summary>Compares a proof with the stored hash in constant time.</summary>
    /// <param name="proof">The proof sent by the recipient's browser.</param>
    /// <param name="storedHash">The hash stored when the share was created.</param>
    public static bool ProofMatches(string? proof, string storedHash)
    {
        var hash = HashProof(proof);
        return hash is not null && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(hash), Encoding.ASCII.GetBytes(storedHash));
    }

    /// <summary>Hashes an e-mail code together with the share it belongs to.</summary>
    /// <param name="shareId">The share's ID.</param>
    /// <param name="code">The six-digit code.</param>
    public static string HashCode(string shareId, string code)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("share-code:" + shareId + ":" + code)));

    /// <summary>Compares an entered code with the stored hash in constant time.</summary>
    /// <param name="shareId">The share's ID.</param>
    /// <param name="code">The code the recipient entered.</param>
    /// <param name="storedHash">The stored hash.</param>
    public static bool CodeMatches(string shareId, string? code, string storedHash)
    {
        var entered = (code ?? string.Empty).Trim();
        if (entered.Length != 6)
        {
            return false;
        }
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(HashCode(shareId, entered)), Encoding.ASCII.GetBytes(storedHash));
    }

    /// <summary>
    /// Checks the encrypted parts sent when a share is created: Base64 ciphertext, a 12-byte nonce, a 16-byte salt, and
    /// Argon2id parameters within sane bounds. Returns an error text, or null when everything is fine.
    /// </summary>
    /// <param name="ciphertext">The ciphertext, Base64.</param>
    /// <param name="iv">The AES-GCM nonce, Base64.</param>
    /// <param name="salt">The key-derivation salt, Base64.</param>
    /// <param name="kdfParams">The Argon2 parameters, or null without recipient password.</param>
    public static string? CheckCrypto(string? ciphertext, string? iv, string? salt, string? kdfParams)
    {
        if (string.IsNullOrEmpty(ciphertext) || ciphertext.Length > MaxCiphertextLength || DecodeBase64(ciphertext) is not { Length: > 16 })
        {
            return "The encrypted secret is missing, too large or malformed.";
        }
        if (DecodeBase64(iv) is not { Length: 12 })
        {
            return "The nonce must be 12 bytes.";
        }
        if (DecodeBase64(salt) is not { Length: 16 })
        {
            return "The salt must be 16 bytes.";
        }
        if (kdfParams is not null)
        {
            var match = KdfPattern().Match(kdfParams);
            if (!match.Success
                || !int.TryParse(match.Groups[1].Value, out var memory) || memory is < 8192 or > 262144
                || !int.TryParse(match.Groups[2].Value, out var time) || time is < 1 or > 10
                || !int.TryParse(match.Groups[3].Value, out var lanes) || lanes is < 1 or > 4)
            {
                return "The key derivation parameters are not supported.";
            }
        }
        return null;
    }

    /// <summary>Masks an e-mail address for the recipient page, for example a***@example.com.</summary>
    /// <param name="email">The address.</param>
    public static string MaskEmail(string email)
    {
        var at = email.IndexOf('@', StringComparison.Ordinal);
        return at <= 0 ? "***" : email[0] + "***" + email[at..];
    }

    /// <summary>Encodes bytes as Base64url without padding.</summary>
    /// <param name="bytes">The bytes.</param>
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Decodes Base64url (with or without padding); returns null when it is malformed.</summary>
    /// <param name="value">The text.</param>
    private static byte[]? DecodeBase64Url(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 128)
        {
            return null;
        }
        var text = value.Replace('-', '+').Replace('_', '/');
        return DecodeBase64(text.PadRight(text.Length + (4 - text.Length % 4) % 4, '='));
    }

    /// <summary>Decodes standard Base64; returns null when it is malformed.</summary>
    /// <param name="value">The text.</param>
    private static byte[]? DecodeBase64(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }
        try
        {
            return Convert.FromBase64String(value);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    /// <summary>The accepted format of the Argon2 parameters, for example "argon2id:m=65536,t=3,p=1".</summary>
    [GeneratedRegex("^argon2id:m=(\\d{1,6}),t=(\\d{1,2}),p=(\\d)$")]
    private static partial Regex KdfPattern();
}

/// <summary>Removes the ciphertext of expired shares every hour and forgets ended shares after 30 days.</summary>
/// <param name="db">The SQLite store for KeePort metadata.</param>
/// <param name="logger">The container log.</param>
public sealed class ShareCleanupService(KeePortDb db, ILogger<ShareCleanupService> logger) : BackgroundService
{
    /// <summary>Cleans up once at start and then every hour until the app stops.</summary>
    /// <param name="stoppingToken">Signals that the app is stopping.</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                db.CleanUpShares(DateTimeOffset.UtcNow, ShareService.KeepEndedDays);
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException)
            {
                logger.LogWarning(ex, "Expired shares could not be cleaned up.");
            }
            try
            {
                await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
