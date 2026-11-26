namespace KeePort.Api.Data;

/// <summary>Holds the per-minute request limits for authentication and WebDAV.</summary>
/// <param name="AuthPerMinute">The per-IP budget shared by login and first-run setup requests.</param>
/// <param name="WebDavPerMinute">The per-IP budget for WebDAV requests.</param>
public sealed record RateLimitSettings(int AuthPerMinute, int WebDavPerMinute)
{
    public const int DefaultAuthPerMinute = 10;
    public const int DefaultWebDavPerMinute = 60;
}

public enum UserRole
{
    Admin,
    User
}

public enum VaultPermission
{
    Read,
    ReadWrite
}

public sealed class UserRecord
{
    public required string Id { get; init; }
    public required string Username { get; init; }
    public required string PasswordHash { get; init; }
    public required UserRole Role { get; init; }
    public required bool Disabled { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? LastLoginAt { get; init; }
    public int? AutoLockMinutes { get; init; }
    public string? Email { get; init; }
    /// <summary>Whether the web vault loads website icons directly from the sites in the user's entries (opt-in).</summary>
    public bool ShowFavicons { get; init; }
    /// <summary>Seconds after which the web vault clears copied values from the clipboard; null for the default, 0 for off.</summary>
    public int? ClipboardClearSeconds { get; init; }
    /// <summary>Whether the web vault checks passwords against "Have I Been Pwned" (opt-in, k-anonymity).</summary>
    public bool CheckBreaches { get; init; }
    /// <summary>The interface language (de, en, fr), or null to follow the browser.</summary>
    public string? Language { get; init; }
}

public sealed record SessionRecord
{
    public required string Id { get; init; }
    public required string UserId { get; init; }
    public required string TokenHash { get; init; }
    public required string CsrfToken { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public DateTimeOffset? LastSeenAt { get; init; }
    public string? UserAgent { get; init; }
    public string? IpAddress { get; init; }
    public UserRecord? User { get; init; }
}

public sealed record VaultFileRecord
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string StoredName { get; init; }
    public required long Size { get; init; }
    public required string Sha256 { get; init; }
    public required long Revision { get; init; }
    public required string ETag { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset UpdatedAt { get; init; }
    public DateTimeOffset? DeletedAt { get; init; }
    public string? CreatedBy { get; init; }
    public string? UpdatedBy { get; init; }

    public string Permission { get; set; } = "none";
}

public sealed class VaultPermissionRecord
{
    public required string FileId { get; init; }
    public required string UserId { get; init; }
    public required VaultPermission Permission { get; init; }
    public required DateTimeOffset UpdatedAt { get; init; }
    public string? Username { get; init; }
}

public sealed class WebDavCredentialRecord
{
    public required string Id { get; init; }
    public required string UserId { get; init; }
    public required string Username { get; init; }
    public required string Label { get; init; }
    public required string PasswordHash { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? LastUsedAt { get; init; }
    public DateTimeOffset? RevokedAt { get; init; }
    public UserRecord? User { get; set; }
}

/// <summary>Represents the account details returned by the user and authentication APIs.</summary>
/// <param name="Id">The stable identifier for this resource.</param>
/// <param name="Username">The account or credential name used for sign-in.</param>
/// <param name="Role">The account role, such as admin or user.</param>
/// <param name="Disabled">Whether the account is prevented from signing in.</param>
/// <param name="CreatedAt">The timestamp when the resource was created.</param>
/// <param name="LastLoginAt">The most recent successful sign-in time, if any.</param>
/// <param name="AutoLockMinutes">The delay in minutes before auto-lock, or null to clear the user override.</param>
/// <param name="Email">The account's contact email address.</param>
/// <param name="ShowFavicons">Whether the web vault loads website icons directly from the sites (opt-in).</param>
/// <param name="ClipboardClearSeconds">Seconds after which copied values are cleared, null for the default, 0 for off.</param>
/// <param name="CheckBreaches">Whether the web vault checks passwords against "Have I Been Pwned" (opt-in).</param>
/// <param name="Language">The interface language (de, en, fr), or null to follow the browser.</param>
public sealed record UserDto(
    string Id,
    string Username,
    string Role,
    bool Disabled,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAt,
    int? AutoLockMinutes = null,
    string? Email = null,
    bool ShowFavicons = false,
    int? ClipboardClearSeconds = null,
    bool CheckBreaches = false,
    string? Language = null);

/// <summary>Represents vault file metadata without the encrypted file contents.</summary>
/// <param name="Id">The stable identifier for this resource.</param>
/// <param name="Name">The display filename for the encrypted vault.</param>
/// <param name="Size">The encrypted file size in bytes.</param>
/// <param name="Revision">The revision number of the file content.</param>
/// <param name="Etag">The entity tag identifying the file revision.</param>
/// <param name="CreatedAt">The timestamp when the resource was created.</param>
/// <param name="UpdatedAt">The timestamp of the last recorded file update.</param>
/// <param name="Permission">The API access level, such as read or read-write.</param>
/// <param name="DeletedAt">The soft-deletion time, or null while the file is active.</param>
public sealed record VaultFileDto(
    string Id,
    string Name,
    long Size,
    long Revision,
    string Etag,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string Permission,
    DateTimeOffset? DeletedAt = null);

/// <summary>Returns the signed-in user's details and CSRF token.</summary>
/// <param name="User">The account data associated with the response.</param>
/// <param name="CsrfToken">The token the session must submit with mutating requests.</param>
public sealed record AuthResponse(UserDto User, string CsrfToken);

/// <summary>Reports whether first-run setup is required and whether accounts exist.</summary>
/// <param name="RequiresSetup">Whether first-run administrator setup is available and required.</param>
/// <param name="HasUsers">Whether any accounts already exist.</param>
public sealed record SetupStatusResponse(bool RequiresSetup, bool HasUsers);

/// <summary>Carries credentials for signing in to the selected application.</summary>
/// <param name="Username">The account or credential name used for sign-in.</param>
/// <param name="Password">The plaintext password submitted by the caller for authentication or hashing.</param>
public sealed record LoginRequest(string Username, string Password);

/// <summary>Carries the current password and its replacement for a self-service change.</summary>
/// <param name="CurrentPassword">The existing login password used to authorize the change.</param>
/// <param name="NewPassword">The replacement login password to validate and hash.</param>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

/// <summary>Carries the user's auto-lock preference, or null to clear it.</summary>
/// <param name="AutoLockMinutes">The delay in minutes before auto-lock, or null to leave it unchanged.</param>
/// <param name="ShowFavicons">Whether the web vault loads website icons from the sites, or null to leave it unchanged.</param>
/// <param name="ClipboardClearSeconds">Seconds until copied values are cleared (0 = off), or null to leave it unchanged.</param>
/// <param name="CheckBreaches">Whether to check passwords against "Have I Been Pwned", or null to leave it unchanged.</param>
public sealed record UpdateSettingsRequest(int? AutoLockMinutes, bool? ShowFavicons = null, int? ClipboardClearSeconds = null, bool? CheckBreaches = null);

/// <summary>Carries a replacement email address for the signed-in account.</summary>
/// <param name="Email">The account's contact email address.</param>
public sealed record UpdateEmailRequest(string? Email);

/// <summary>Changes the interface language of the signed-in account.</summary>
/// <param name="Language">de, en or fr, or null to follow the browser.</param>
public sealed record UpdateLanguageRequest(string? Language);

/// <summary>Carries the setup token and credentials for creating the first administrator.</summary>
/// <param name="SetupToken">The one-time token authorizing first administrator setup.</param>
/// <param name="Username">The account or credential name used for sign-in.</param>
/// <param name="Password">The plaintext password submitted by the caller for authentication or hashing.</param>
/// <param name="Email">The account's contact email address.</param>
public sealed record SetupRequest(string SetupToken, string Username, string Password, string? Email);

/// <summary>Carries the account details an administrator supplies when creating a user.</summary>
/// <param name="Username">The account or credential name used for sign-in.</param>
/// <param name="Password">The plaintext password submitted by the caller for authentication or hashing.</param>
/// <param name="Role">The account role, such as admin or user.</param>
/// <param name="Email">The account's contact email address.</param>
public sealed record CreateUserRequest(string Username, string Password, string Role, string? Email);

/// <summary>Carries optional account changes made by an administrator.</summary>
/// <param name="Role">The replacement role, or null to leave the role unchanged.</param>
/// <param name="Disabled">The new disabled flag, or null to leave it unchanged.</param>
/// <param name="Password">The replacement login password, or null to leave it unchanged.</param>
public sealed record UpdateUserRequest(string? Role, bool? Disabled, string? Password);

/// <summary>Carries the new password for a password reset.</summary>
/// <param name="Password">The plaintext password submitted by the caller for authentication or hashing.</param>
public sealed record ResetPasswordRequest(string Password);

/// <summary>Carries the replacement display name for a vault.</summary>
/// <param name="Name">The desired display filename for the vault.</param>
public sealed record RenameVaultFileRequest(string Name);

/// <summary>Pairs a user ID with the requested access level for a vault.</summary>
/// <param name="UserId">The ID of the user account.</param>
/// <param name="Permission">The API access level, such as read or read-write.</param>
public sealed record PermissionInput(string UserId, string Permission);

/// <summary>Carries the complete replacement access list for a vault.</summary>
/// <param name="Permissions">The complete set of grants that will replace existing permissions for the vault.</param>
public sealed record SetPermissionsRequest(IReadOnlyList<PermissionInput> Permissions);

/// <summary>Carries the owner, label, and password for a new WebDAV credential.</summary>
/// <param name="UserId">The ID of the user account.</param>
/// <param name="Label">The human-readable credential label.</param>
/// <param name="Password">The plaintext password submitted by the caller for authentication or hashing.</param>
public sealed record CreateWebDavCredentialRequest(string UserId, string Label, string Password);

/// <summary>Exposes credential metadata without its password hash.</summary>
/// <param name="Id">The stable identifier for this resource.</param>
/// <param name="UserId">The ID of the user account.</param>
/// <param name="Username">The account or credential name used for sign-in.</param>
/// <param name="Label">The human-readable credential label.</param>
/// <param name="CreatedAt">The timestamp when the resource was created.</param>
/// <param name="LastUsedAt">The most recent successful credential use, if any.</param>
/// <param name="RevokedAt">The time the credential was revoked, if it has been revoked.</param>
public sealed record WebDavCredentialDto(string Id, string UserId, string Username, string Label, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt);

/// <summary>Describes one logged WebDAV request without credentials or file content.</summary>
/// <param name="Id">The sequential log entry ID.</param>
/// <param name="OccurredAt">The time the request completed.</param>
/// <param name="Method">The HTTP method of the request.</param>
/// <param name="Path">The requested path below the server root.</param>
/// <param name="Status">The HTTP status code returned to the client.</param>
/// <param name="Credential">The WebDAV username that authenticated the request, or null if authentication failed.</param>
/// <param name="RemoteIp">The client IP address as seen by KeePort, if known.</param>
/// <param name="DurationMs">The processing time in milliseconds.</param>
/// <param name="ContentLength">The declared request body size in bytes, if any.</param>
/// <param name="IfMatch">Whether the request carried an If-Match header.</param>
/// <param name="Depth">The Depth header value, if any.</param>
/// <param name="Destination">The Destination header value of a MOVE, if any.</param>
/// <param name="Overwrite">The Overwrite header value, if any.</param>
public sealed record WebDavRequestLogDto(
    long Id,
    DateTimeOffset OccurredAt,
    string Method,
    string Path,
    int Status,
    string? Credential,
    string? RemoteIp,
    long DurationMs,
    long? ContentLength,
    bool IfMatch,
    string? Depth,
    string? Destination,
    string? Overwrite);

/// <summary>Describes where KeePort keeps its data, for the admin console.</summary>
/// <param name="Kind">hostFolder, dockerVolume, notMounted or unknown.</param>
/// <param name="DataDir">The data directory inside the container.</param>
/// <param name="Source">The source path on the host's file system, if known (on a NAS possibly relative to the storage volume).</param>
/// <param name="VolumeName">The Docker volume name when the data is stored in a volume.</param>
/// <param name="NeedsAttention">Whether NAS backup tools are likely to miss the data.</param>
public sealed record DataStorageDto(string Kind, string DataDir, string? Source, string? VolumeName, bool NeedsAttention);

/// <summary>Represents an API error and, for write conflicts, the current ETag when known.</summary>
/// <param name="Error">The machine-readable API error code.</param>
/// <param name="Message">Optional human-readable detail about the error.</param>
/// <param name="CurrentETag">The current file entity tag, if known.</param>
public sealed record ErrorResponse(string Error, string? Message = null, string? CurrentETag = null);

/// <summary>The channel a sign-in was made through, for the sign-in counters.</summary>
public enum LoginChannel
{
    /// <summary>The admin console.</summary>
    Admin,
    /// <summary>The web vault.</summary>
    Vault
}

/// <summary>Successful and rejected sign-ins of one channel in one time window.</summary>
/// <param name="Success">Sign-ins that created a session.</param>
/// <param name="Failure">Sign-ins rejected by the handler (wrong credentials, disabled account or wrong role); rate-limited requests are not included.</param>
public sealed record LoginCounts(long Success, long Failure);

/// <summary>Sign-in counts per channel for the last 24 hours and the last 7 days.</summary>
/// <param name="Since">When KeePort started counting sign-ins; earlier sign-ins are not included.</param>
/// <param name="AdminLast24Hours">Admin console sign-ins in the last 24 hours.</param>
/// <param name="AdminLast7Days">Admin console sign-ins in the last 7 days.</param>
/// <param name="VaultLast24Hours">Web vault sign-ins in the last 24 hours.</param>
/// <param name="VaultLast7Days">Web vault sign-ins in the last 7 days.</param>
public sealed record LoginStatsDto(
    DateTimeOffset Since,
    LoginCounts AdminLast24Hours,
    LoginCounts AdminLast7Days,
    LoginCounts VaultLast24Hours,
    LoginCounts VaultLast7Days);

/// <summary>Vault, account and WebDAV totals read with aggregate queries.</summary>
/// <param name="Vaults">Vault files that are not deleted, without conflict copies.</param>
/// <param name="DeletedVaults">Soft-deleted vault files that can still be restored.</param>
/// <param name="ConflictCopies">Conflict copies that are not deleted and wait for an administrator.</param>
/// <param name="Users">All vault user accounts.</param>
/// <param name="DisabledUsers">Disabled vault user accounts.</param>
/// <param name="Admins">All administrator accounts.</param>
/// <param name="DisabledAdmins">Disabled administrator accounts.</param>
/// <param name="ActiveWebDavCredentials">WebDAV app passwords that are not revoked.</param>
/// <param name="WebDavRequestsLast24Hours">WebDAV requests in the last 24 hours, from the retained request log.</param>
/// <param name="WebDavErrorsLast24Hours">WebDAV requests answered with a status of 400 or higher in the last 24 hours, without 401 sign-in prompts.</param>
/// <param name="WebDavStaleWritesLast24Hours">WebDAV writes rejected as outdated (412) in the last 24 hours.</param>
/// <param name="LastWebDavRequestAt">When the last WebDAV request arrived, if any is logged.</param>
public sealed record DashboardCountsDto(
    long Vaults,
    long DeletedVaults,
    long ConflictCopies,
    long Users,
    long DisabledUsers,
    long Admins,
    long DisabledAdmins,
    long ActiveWebDavCredentials,
    long WebDavRequestsLast24Hours,
    long WebDavErrorsLast24Hours,
    long WebDavStaleWritesLast24Hours,
    DateTimeOffset? LastWebDavRequestAt);

/// <summary>Information about the running KeePort process for the admin dashboard.</summary>
/// <param name="Version">The KeePort version from the build metadata.</param>
/// <param name="Commit">The build commit, if it was recorded at build time.</param>
/// <param name="Runtime">The .NET runtime description.</param>
/// <param name="OperatingSystem">The operating system and process architecture.</param>
/// <param name="InDocker">Whether KeePort runs in a Docker container.</param>
/// <param name="StartedAt">When the process started.</param>
/// <param name="UptimeSeconds">How long the process has been running.</param>
/// <param name="Addresses">The IP addresses of the instance; inside Docker these are container addresses.</param>
/// <param name="VaultPorts">The ports the web vault and WebDAV listen on (inside the container when in Docker).</param>
/// <param name="AdminPorts">The ports the admin console listens on (inside the container when in Docker).</param>
/// <param name="AdminHttps">Whether the admin console uses HTTPS.</param>
/// <param name="AdminCertificateFingerprint">The SHA-256 fingerprint of the self-signed admin certificate, if used.</param>
/// <param name="AdminCertificateNotAfter">When the admin certificate expires, if used.</param>
/// <param name="TrustedProxies">The trusted reverse proxies, as in the startup log.</param>
public sealed record ServerInfoDto(
    string Version,
    string? Commit,
    string Runtime,
    string OperatingSystem,
    bool InDocker,
    DateTimeOffset StartedAt,
    long UptimeSeconds,
    IReadOnlyList<string> Addresses,
    IReadOnlyList<int> VaultPorts,
    IReadOnlyList<int> AdminPorts,
    bool AdminHttps,
    string? AdminCertificateFingerprint,
    DateTimeOffset? AdminCertificateNotAfter,
    string TrustedProxies);

/// <summary>Everything the admin dashboard shows. Parts that could not be read are null and listed in Errors.</summary>
/// <param name="GeneratedAt">When the data was collected.</param>
/// <param name="Server">Information about the running process.</param>
/// <param name="Storage">Where KeePort keeps its data.</param>
/// <param name="Counts">Vault, account and WebDAV totals, or null if the database could not be read.</param>
/// <param name="Logins">Sign-in counts, or null if they could not be read.</param>
/// <param name="Errors">Short descriptions of the parts that could not be read.</param>
public sealed record DashboardDto(
    DateTimeOffset GeneratedAt,
    ServerInfoDto Server,
    DataStorageDto Storage,
    DashboardCountsDto? Counts,
    LoginStatsDto? Logins,
    IReadOnlyList<string> Errors);

/// <summary>Describes one audit log entry: who did what, to which object, with which result.</summary>
/// <param name="Id">The sequential log entry ID.</param>
/// <param name="OccurredAt">The time of the event.</param>
/// <param name="Category">The area of the event: auth, account, user, vault, webdav or settings.</param>
/// <param name="Action">The action tag in PascalCase, e.g. LoginFailed or VaultPermissionsChanged.</param>
/// <param name="Success">Whether the action succeeded.</param>
/// <param name="ActorId">The ID of the acting account, or null for unknown accounts and the system.</param>
/// <param name="ActorName">The acting account's username at the time of the event, or the name typed at a failed sign-in.</param>
/// <param name="TargetType">The kind of object acted on: user, vault, appPassword or settings.</param>
/// <param name="TargetId">The ID of the object acted on, if any.</param>
/// <param name="TargetName">The name of the object acted on at the time of the event, if any.</param>
/// <param name="Details">A short, secret-free description such as "Read → ReadWrite" or "Revision 41".</param>
/// <param name="RemoteIp">The client IP address as seen by KeePort, if known.</param>
/// <param name="UserAgent">The browser or app that sent the request, shortened, if known.</param>
public sealed record AuditEntryDto(
    long Id,
    DateTimeOffset OccurredAt,
    string Category,
    string Action,
    bool Success,
    string? ActorId,
    string? ActorName,
    string? TargetType,
    string? TargetId,
    string? TargetName,
    string? Details,
    string? RemoteIp,
    string? UserAgent);

/// <summary>Filters for listing or exporting the audit log; null or empty values do not filter.</summary>
/// <param name="Actor">Part of the acting account's name.</param>
/// <param name="Action">One action tag.</param>
/// <param name="Category">One category.</param>
/// <param name="From">The earliest event time, inclusive.</param>
/// <param name="To">The latest event time, exclusive.</param>
/// <param name="FailedOnly">Whether to list only failed actions.</param>
/// <param name="Search">Free text matched against action, accounts, target, details and IP address.</param>
public sealed record AuditFilter(
    string? Actor = null,
    string? Action = null,
    string? Category = null,
    DateTimeOffset? From = null,
    DateTimeOffset? To = null,
    bool FailedOnly = false,
    string? Search = null);

/// <summary>Headline counts of the audit log for the admin console.</summary>
/// <param name="Total">All retained entries.</param>
/// <param name="Last24Hours">Entries of the last 24 hours.</param>
/// <param name="Last7Days">Entries of the last 7 days.</param>
/// <param name="FailedSignIns24Hours">Failed sign-ins of the last 24 hours.</param>
public sealed record AuditStatsDto(long Total, long Last24Hours, long Last7Days, long FailedSignIns24Hours);

/// <summary>One page of the audit log with the counts and the known action tags for the filters.</summary>
/// <param name="Items">The entries of the page, newest first.</param>
/// <param name="Total">The number of entries matching the filter.</param>
/// <param name="Page">The 1-based page number.</param>
/// <param name="PageSize">The number of entries per page.</param>
/// <param name="Stats">The headline counts of the whole log.</param>
/// <param name="Actions">All known action tags with their category, for the filter.</param>
public sealed record AuditPageDto(
    IReadOnlyList<AuditEntryDto> Items,
    long Total,
    int Page,
    int PageSize,
    AuditStatsDto Stats,
    IReadOnlyList<AuditActionDto> Actions);

/// <summary>One known action tag and the category it belongs to.</summary>
/// <param name="Action">The action tag.</param>
/// <param name="Category">The category of the tag.</param>
public sealed record AuditActionDto(string Action, string Category);

/// <summary>How long audit log entries are kept.</summary>
/// <param name="RetentionDays">Days to keep entries, 1 to 3650.</param>
public sealed record AuditSettingsDto(int RetentionDays);

/// <summary>One sign-in attempt on the user's own account, shown in their profile.</summary>
/// <param name="OccurredAt">The time of the attempt.</param>
/// <param name="Success">Whether the sign-in succeeded.</param>
/// <param name="Channel">"web vault" or "admin console".</param>
/// <param name="RemoteIp">The client IP address as seen by KeePort, if known.</param>
/// <param name="UserAgent">The browser that signed in, shortened, if known.</param>
public sealed record SignInDto(DateTimeOffset OccurredAt, bool Success, string? Channel, string? RemoteIp, string? UserAgent);

/// <summary>Who saved one revision of a vault, how, and whether an earlier version's file is kept.</summary>
/// <param name="FileId">The vault's ID.</param>
/// <param name="Revision">The revision number.</param>
/// <param name="Size">The encrypted size in bytes.</param>
/// <param name="Sha256">The SHA-256 of the encrypted content.</param>
/// <param name="SavedAt">When the revision was saved.</param>
/// <param name="SavedBy">The ID of the account that saved it, if known.</param>
/// <param name="SavedByName">That account's username at the time, if known.</param>
/// <param name="Source">How it was saved, e.g. "Web vault", "WebDAV · Pixel 8", "Upload", "Restore of revision 37".</param>
/// <param name="Archived">Whether the revision is kept as an earlier version file.</param>
public sealed record VaultRevisionRecord(
    string FileId,
    long Revision,
    long Size,
    string Sha256,
    DateTimeOffset SavedAt,
    string? SavedBy,
    string? SavedByName,
    string? Source,
    bool Archived);

/// <summary>One earlier version of a vault for the admin console.</summary>
/// <param name="Revision">The revision number.</param>
/// <param name="Size">The encrypted size in bytes.</param>
/// <param name="SavedAt">When the revision was saved.</param>
/// <param name="SavedBy">Who saved it, if known.</param>
/// <param name="Source">How it was saved, if known.</param>
public sealed record VaultVersionDto(long Revision, long Size, DateTimeOffset SavedAt, string? SavedBy, string? Source);

/// <summary>The current revision and the kept earlier versions of a vault.</summary>
/// <param name="Current">The current revision.</param>
/// <param name="Versions">The kept earlier versions, newest first.</param>
public sealed record VaultVersionsDto(VaultVersionDto Current, IReadOnlyList<VaultVersionDto> Versions);

/// <summary>How many earlier versions of each vault are kept, and how much space they use.</summary>
/// <param name="MaxCount">Versions kept per vault, 0 to 1000; 0 turns versions off.</param>
/// <param name="MaxDays">Days a version is kept, 0 to 3650; 0 keeps them regardless of age.</param>
/// <param name="UsedBytes">Space used by all kept versions; ignored when saving.</param>
public sealed record VersionSettingsDto(int MaxCount, int MaxDays, long UsedBytes = 0);
