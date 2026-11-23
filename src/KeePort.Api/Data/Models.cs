namespace KeePort.Api.Data;

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

public sealed record UserDto(string Id, string Username, string Role, bool Disabled, DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt);

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

public sealed record AuthResponse(UserDto User, string CsrfToken);

public sealed record SetupStatusResponse(bool RequiresSetup, bool HasUsers);

public sealed record LoginRequest(string Username, string Password);

public sealed record SetupRequest(string SetupToken, string Username, string Password);

public sealed record CreateUserRequest(string Username, string Password, string Role);

public sealed record UpdateUserRequest(string? Role, bool? Disabled, string? Password);

public sealed record ResetPasswordRequest(string Password);

public sealed record RenameVaultFileRequest(string Name);

public sealed record PermissionInput(string UserId, string Permission);

public sealed record SetPermissionsRequest(IReadOnlyList<PermissionInput> Permissions);

public sealed record CreateWebDavCredentialRequest(string UserId, string Label, string Password);

public sealed record WebDavCredentialDto(string Id, string UserId, string Username, string Label, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt);

public sealed record ErrorResponse(string Error, string? Message = null, string? CurrentETag = null);
