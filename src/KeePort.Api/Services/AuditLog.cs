using KeePort.Api.Data;
using KeePort.Api.Security;
using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Services;

/// <summary>The action tags of the audit log, grouped by category. Tags never change once released.</summary>
public static class AuditActions
{
    public const string LoginSucceeded = nameof(LoginSucceeded);
    public const string LoginFailed = nameof(LoginFailed);
    public const string Logout = nameof(Logout);
    public const string SetupCompleted = nameof(SetupCompleted);

    public const string PasswordChanged = nameof(PasswordChanged);
    public const string EmailChanged = nameof(EmailChanged);
    public const string SettingsChanged = nameof(SettingsChanged);

    public const string UserCreated = nameof(UserCreated);
    public const string UserRoleChanged = nameof(UserRoleChanged);
    public const string UserDisabled = nameof(UserDisabled);
    public const string UserEnabled = nameof(UserEnabled);
    public const string UserPasswordReset = nameof(UserPasswordReset);
    public const string UserDeleted = nameof(UserDeleted);

    public const string VaultUploaded = nameof(VaultUploaded);
    public const string VaultRenamed = nameof(VaultRenamed);
    public const string VaultDeleted = nameof(VaultDeleted);
    public const string VaultRestored = nameof(VaultRestored);
    public const string VaultPermissionsChanged = nameof(VaultPermissionsChanged);
    public const string VaultSaved = nameof(VaultSaved);
    public const string VaultConflictCopy = nameof(VaultConflictCopy);
    public const string VaultDownloaded = nameof(VaultDownloaded);
    public const string VaultVersionRestored = nameof(VaultVersionRestored);

    public const string AppPasswordCreated = nameof(AppPasswordCreated);
    public const string AppPasswordRevoked = nameof(AppPasswordRevoked);

    public const string RateLimitsChanged = nameof(RateLimitsChanged);
    public const string AuditRetentionChanged = nameof(AuditRetentionChanged);
    public const string VersionSettingsChanged = nameof(VersionSettingsChanged);

    /// <summary>Every known tag with its category, in the order shown in the admin console's filter.</summary>
    public static readonly IReadOnlyList<AuditActionDto> All =
    [
        new(LoginSucceeded, "auth"), new(LoginFailed, "auth"), new(Logout, "auth"), new(SetupCompleted, "auth"),
        new(PasswordChanged, "account"), new(EmailChanged, "account"), new(SettingsChanged, "account"),
        new(UserCreated, "user"), new(UserRoleChanged, "user"), new(UserDisabled, "user"), new(UserEnabled, "user"),
        new(UserPasswordReset, "user"), new(UserDeleted, "user"),
        new(VaultUploaded, "vault"), new(VaultRenamed, "vault"), new(VaultDeleted, "vault"), new(VaultRestored, "vault"),
        new(VaultPermissionsChanged, "vault"), new(VaultSaved, "vault"), new(VaultConflictCopy, "vault"), new(VaultDownloaded, "vault"),
        new(VaultVersionRestored, "vault"),
        new(AppPasswordCreated, "webdav"), new(AppPasswordRevoked, "webdav"),
        new(RateLimitsChanged, "settings"), new(AuditRetentionChanged, "settings"), new(VersionSettingsChanged, "settings")
    ];

    private static readonly Dictionary<string, string> Categories = All.ToDictionary(/* Tag. */ a => a.Action, /* Category. */ a => a.Category);

    /// <summary>Returns the category of a known tag.</summary>
    /// <param name="action">The action tag.</param>
    /// <exception cref="ArgumentException">The tag is not in <see cref="All"/>.</exception>
    public static string CategoryOf(string action)
        => Categories.TryGetValue(action, out var category) ? category : throw new ArgumentException($"Unknown audit action '{action}'.", nameof(action));
}

/// <summary>
/// Writes audit log entries. Recording never changes the outcome of the action it describes: a failure to write is
/// reported in the container log and otherwise ignored. Entries never contain passwords, tokens or vault content.
/// </summary>
public sealed class AuditLog
{
    private const int MaxTextLength = 200;
    private const int MaxUserAgentLength = 300;

    private readonly KeePortDb _db;
    private readonly ILogger<AuditLog> _logger;
    private int _retentionDays;

    /// <summary>Creates the audit log and reads the configured retention.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="logger">The container log for write failures.</param>
    public AuditLog(KeePortDb db, ILogger<AuditLog> logger)
    {
        _db = db;
        _logger = logger;
        _retentionDays = db.GetAuditRetentionDays();
    }

    /// <summary>The number of days entries are kept.</summary>
    public int RetentionDays => _retentionDays;

    /// <summary>Changes how many days entries are kept and removes older entries.</summary>
    /// <param name="days">Days to keep entries.</param>
    public void SetRetentionDays(int days)
    {
        _db.SetAuditRetentionDays(days);
        _retentionDays = days;
    }

    /// <summary>Records one event. The acting account defaults to the signed-in account of the request.</summary>
    /// <param name="context">The request that caused the event, for account, IP address and browser; null for the system.</param>
    /// <param name="action">One of the <see cref="AuditActions"/> tags.</param>
    /// <param name="success">Whether the action succeeded.</param>
    /// <param name="actor">The acting account, when it differs from the signed-in account (e.g. at sign-in).</param>
    /// <param name="actorName">The name to record when no account exists, e.g. the name typed at a failed sign-in.</param>
    /// <param name="targetType">The kind of object acted on: user, vault, appPassword or settings.</param>
    /// <param name="targetId">The ID of the object acted on.</param>
    /// <param name="targetName">The name of the object acted on.</param>
    /// <param name="details">A short, secret-free description.</param>
    public void Record(
        HttpContext? context,
        string action,
        bool success = true,
        UserRecord? actor = null,
        string? actorName = null,
        string? targetType = null,
        string? targetId = null,
        string? targetName = null,
        string? details = null)
    {
        try
        {
            actor ??= context is null ? null : ApiAuth.GetUser(context);
            var userAgent = context?.Request.Headers.UserAgent.ToString();
            _db.AddAuditEntry(new AuditEntryDto(
                0,
                DateTimeOffset.UtcNow,
                AuditActions.CategoryOf(action),
                action,
                success,
                actor?.Id,
                Shorten(actor?.Username ?? actorName, MaxTextLength),
                targetType,
                targetId,
                Shorten(targetName, MaxTextLength),
                Shorten(details, MaxTextLength * 2),
                context is null ? null : ClientIp.Format(context.Connection.RemoteIpAddress),
                string.IsNullOrWhiteSpace(userAgent) ? null : Shorten(userAgent, MaxUserAgentLength)),
                _retentionDays);
        }
        catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException or ArgumentException)
        {
            _logger.LogWarning(ex, "Could not write audit log entry {Action}.", action);
        }
    }

    /// <summary>Cuts a text to a maximum length, keeping null as null.</summary>
    /// <param name="text">The text to shorten.</param>
    /// <param name="maxLength">The maximum number of characters.</param>
    private static string? Shorten(string? text, int maxLength)
    {
        if (text is null)
        {
            return null;
        }
        var trimmed = text.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..(maxLength - 1)] + "…";
    }
}
