using System.Security.Cryptography;
using System.Text.Json;
using KeePort.Api.Data;
using Microsoft.AspNetCore.DataProtection;

namespace KeePort.Api.Services;

/// <summary>The stored SMTP settings, with the password still encrypted.</summary>
/// <param name="Host">The SMTP server name.</param>
/// <param name="Port">The SMTP port.</param>
/// <param name="Security">starttls, ssl or none.</param>
/// <param name="Username">The SMTP user, if any.</param>
/// <param name="ProtectedPassword">The SMTP password, encrypted with Data Protection, if any.</param>
/// <param name="FromAddress">The sender address.</param>
/// <param name="FromName">The sender name.</param>
/// <param name="PublicUrl">The web vault's address for links.</param>
/// <param name="WarnFailedSignIns">Warn admins about many failed sign-ins.</param>
/// <param name="WarnCertificate">Warn admins about the admin certificate expiring.</param>
/// <param name="WarnStorage">Warn admins when the data is not in a host folder.</param>
/// <param name="WarnDiskSpace">Warn admins about low disk space.</param>
/// <param name="LogRetentionDays">How many days sent and given-up e-mails stay in the log; null for settings saved before 0.23.</param>
public sealed record StoredEmailSettings(
    string? Host,
    int Port,
    string Security,
    string? Username,
    string? ProtectedPassword,
    string? FromAddress,
    string? FromName,
    string? PublicUrl,
    bool WarnFailedSignIns,
    bool WarnCertificate,
    bool WarnStorage,
    bool WarnDiskSpace,
    int? LogRetentionDays = null)
{
    /// <summary>The log retention used when none was chosen.</summary>
    public const int DefaultLogDays = 30;

    /// <summary>The longest log retention an administrator can choose.</summary>
    public const int MaxLogDays = 365;

    /// <summary>The settings before anything was entered.</summary>
    public static StoredEmailSettings Empty { get; } = new(null, 587, "starttls", null, null, null, "KeePort", null, true, true, true, true);

    /// <summary>Whether host, sender and web vault address are set, so e-mails with links can be sent.</summary>
    public bool Configured => !string.IsNullOrWhiteSpace(Host) && !string.IsNullOrWhiteSpace(FromAddress) && !string.IsNullOrWhiteSpace(PublicUrl);

    /// <summary>How many days finished e-mails stay in the log; 30 when nothing valid was stored.</summary>
    public int LogDays => LogRetentionDays is { } days and >= 1 and <= MaxLogDays ? days : DefaultLogDays;
}

/// <summary>
/// Reads and stores the SMTP settings in the database. The SMTP password is encrypted with ASP.NET Core Data Protection
/// (keys in /data/keys); it is decrypted only to send and is never returned to the admin console.
/// </summary>
public sealed class EmailSettingsService
{
    private const string StateKey = "email_settings";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly KeePortDb _db;
    private readonly IDataProtector _protector;

    /// <summary>Creates the service.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="protection">The Data Protection provider used to encrypt the SMTP password.</param>
    public EmailSettingsService(KeePortDb db, IDataProtectionProvider protection)
    {
        _db = db;
        _protector = protection.CreateProtector("KeePort.Email.SmtpPassword");
    }

    /// <summary>Reads the stored settings, or empty settings when none were saved.</summary>
    public StoredEmailSettings Get()
    {
        var json = _db.GetState(StateKey);
        if (json is null)
        {
            return StoredEmailSettings.Empty;
        }
        try
        {
            return JsonSerializer.Deserialize<StoredEmailSettings>(json, Json) ?? StoredEmailSettings.Empty;
        }
        catch (JsonException)
        {
            return StoredEmailSettings.Empty;
        }
    }

    /// <summary>Converts the stored settings into what the admin console shows, without the password.</summary>
    /// <param name="settings">The stored settings.</param>
    public static EmailSettingsDto ToDto(StoredEmailSettings settings) => new(
        settings.Host, settings.Port, settings.Security, settings.Username, null, settings.ProtectedPassword is not null,
        settings.FromAddress, settings.FromName, settings.PublicUrl,
        settings.WarnFailedSignIns, settings.WarnCertificate, settings.WarnStorage, settings.WarnDiskSpace, settings.LogDays);

    /// <summary>
    /// Validates and stores new settings; a null password keeps the stored one, an empty one removes it, and a missing log
    /// retention keeps the stored one.
    /// </summary>
    /// <param name="request">The settings from the admin console.</param>
    /// <returns>An error message for invalid input, otherwise null.</returns>
    public string? Save(EmailSettingsDto request)
    {
        var host = Clean(request.Host);
        if (host is not null && (host.Length > 253 || host.Contains(' ', StringComparison.Ordinal)))
        {
            return "Enter a valid SMTP server name.";
        }
        if (request.Port is < 1 or > 65535)
        {
            return "The SMTP port must be between 1 and 65535.";
        }
        if (request.Security is not ("starttls" or "ssl" or "none"))
        {
            return "Security must be starttls, ssl or none.";
        }
        var from = Clean(request.FromAddress);
        if (from is not null && KeePort.Api.Security.EmailAddress.Normalize(from) is null)
        {
            return "Enter a valid sender address.";
        }
        var publicUrl = Clean(request.PublicUrl)?.TrimEnd('/');
        if (publicUrl is not null && (!Uri.TryCreate(publicUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http") || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)))
        {
            return "Enter the web vault address, e.g. https://vault.example.com.";
        }
        if (request.LogRetentionDays is < 1 or > StoredEmailSettings.MaxLogDays)
        {
            return $"Keep the e-mail log for 1 to {StoredEmailSettings.MaxLogDays} days.";
        }

        var current = Get();
        var protectedPassword = request.Password switch
        {
            null => current.ProtectedPassword,
            "" => null,
            var password => _protector.Protect(password)
        };
        var settings = new StoredEmailSettings(host, request.Port, request.Security, Clean(request.Username), protectedPassword,
            from is null ? null : KeePort.Api.Security.EmailAddress.Normalize(from), Clean(request.FromName) ?? "KeePort", publicUrl,
            request.WarnFailedSignIns, request.WarnCertificate, request.WarnStorage, request.WarnDiskSpace,
            request.LogRetentionDays ?? current.LogDays);
        _db.SetState(StateKey, JsonSerializer.Serialize(settings, Json));
        return null;
    }

    /// <summary>Decrypts the stored SMTP password, or returns null when none is stored or the keys were lost.</summary>
    /// <param name="settings">The stored settings.</param>
    public string? RevealPassword(StoredEmailSettings settings)
    {
        if (settings.ProtectedPassword is null)
        {
            return null;
        }
        try
        {
            return _protector.Unprotect(settings.ProtectedPassword);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>Trims a value and turns an empty one into null.</summary>
    /// <param name="value">The value.</param>
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
