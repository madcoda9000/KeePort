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
public sealed record UserDto(string Id, string Username, string Role, bool Disabled, DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt, int? AutoLockMinutes = null, string? Email = null);

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
/// <param name="AutoLockMinutes">The delay in minutes before auto-lock, or null to clear the user override.</param>
public sealed record UpdateSettingsRequest(int? AutoLockMinutes);

/// <summary>Carries a replacement email address for the signed-in account.</summary>
/// <param name="Email">The account's contact email address.</param>
public sealed record UpdateEmailRequest(string? Email);

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
