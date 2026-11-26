using System.Text;
using System.Text.Json;
using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

public static class AdminEndpoints
{
    /// <summary>Registers administrator-only endpoints for settings, accounts, vault files, permissions, and WebDAV credentials.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin");

        // Returns the active authentication and WebDAV rate limits to an administrator.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="settings">The service that reads or persists the active rate limits.</param>
        group.MapGet("/settings/rate-limits", (HttpContext context, RateLimitSettingsService settings) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(settings.Current.Settings);
        });

        // Reports where KeePort keeps its data (host folder, Docker volume or not mounted) to an administrator.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="storage">The data storage detected at startup.</param>
        group.MapGet("/settings/storage", (HttpContext context, DataStorageInfo storage) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(new DataStorageDto(
                JsonNamingPolicy.CamelCase.ConvertName(storage.Kind.ToString()),
                storage.DataDir,
                storage.Source,
                storage.VolumeName,
                storage.NeedsAttention));
        });

        // Collects the admin dashboard: process information, data storage, totals and sign-in counts. Parts that cannot be
        // read are returned as null and named in "errors", so the console never shows them as zero.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="server">The process information collected at startup.</param>
        // <param name="storage">The data storage detected at startup.</param>
        // <param name="logger">The logger for read failures.</param>
        group.MapGet("/dashboard", (HttpContext context, KeePortDb db, ServerInfo server, DataStorageInfo storage, ILogger<ServerInfo> logger) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var now = DateTimeOffset.UtcNow;
            var errors = new List<string>();
            DashboardCountsDto? counts = null;
            LoginStatsDto? logins = null;
            try
            {
                counts = db.GetDashboardCounts(now);
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException)
            {
                logger.LogWarning(ex, "Could not read the dashboard totals.");
                errors.Add("Vault, account and WebDAV totals could not be read from the database.");
            }
            try
            {
                logins = db.GetLoginStats(now);
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException)
            {
                logger.LogWarning(ex, "Could not read the sign-in counters.");
                errors.Add("Sign-in counts could not be read from the database.");
            }
            return Results.Ok(new DashboardDto(
                now,
                server.ToDto(now),
                new DataStorageDto(
                    JsonNamingPolicy.CamelCase.ConvertName(storage.Kind.ToString()),
                    storage.DataDir,
                    storage.Source,
                    storage.VolumeName,
                    storage.NeedsAttention),
                counts,
                logins,
                errors));
        });

        // Validates the limits, persists both values, and activates the changed policies.
        // <param name="request">The configured login/setup and WebDAV request limits.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="settings">The service that reads or persists the active rate limits.</param>
        group.MapPut("/settings/rate-limits", (RateLimitSettings request, HttpContext context, RateLimitSettingsService settings, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (request.AuthPerMinute <= 0 || request.WebDavPerMinute <= 0)
            {
                return BadRequest("invalid_rate_limit", "Both limits must be positive whole numbers.");
            }
            var before = settings.Current.Settings;
            settings.Update(request);
            audit.Record(context, AuditActions.RateLimitsChanged, targetType: "settings", targetName: "Rate limits",
                details: $"Sign-in {before.AuthPerMinute} → {request.AuthPerMinute}/min, WebDAV {before.WebDavPerMinute} → {request.WebDavPerMinute}/min");
            return Results.Ok(request);
        });

        // Lists accounts for an authenticated administrator.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/users", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(db.ListUsers().Select(AuthEndpoints.ToDto).ToArray());
        });

        // Validates the supplied account details and creates the user with a hashed password.
        // <param name="request">The new account details supplied by the administrator.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
        group.MapPost("/users", (CreateUserRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var usernameError = PasswordPolicy.ValidateUsername(request.Username);
            if (usernameError is not null)
            {
                return BadRequest("invalid_username", usernameError);
            }
            if (!Enum.TryParse<UserRole>(request.Role, ignoreCase: true, out var role))
            {
                return BadRequest("invalid_role", "Role must be 'admin' or 'user'.");
            }
            var passwordError = PasswordPolicy.Validate(request.Password, request.Username);
            if (passwordError is not null)
            {
                return BadRequest("invalid_password", passwordError);
            }
            var email = EmailAddress.Normalize(request.Email);
            if (email is null)
            {
                return BadRequest("invalid_email", "Enter a valid email address.");
            }
            var username = request.Username.Trim();
            if (db.GetUserByUsername(username) is not null)
            {
                return Results.Json(new ErrorResponse("username_taken", "Username is already in use."), statusCode: StatusCodes.Status409Conflict);
            }

            var user = new UserRecord
            {
                Id = Guid.NewGuid().ToString("N"),
                Username = username,
                Email = email,
                PasswordHash = hasher.Hash(request.Password),
                Role = role,
                Disabled = false,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.CreateUser(user);
            audit.Record(context, AuditActions.UserCreated, targetType: "user", targetId: user.Id, targetName: user.Username,
                details: $"Role {user.Role}");
            return Results.Ok(AuthEndpoints.ToDto(user));
        });

        // Updates the role, disabled status, or password without removing the last enabled administrator.
        // <param name="id">The route ID of the account to update.</param>
        // <param name="request">The requested account changes; omitted fields are unchanged.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
        group.MapPatch("/users/{id}", (string id, UpdateUserRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var target = db.GetUserById(id);
            if (target is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "User not found."));
            }

            var role = target.Role;
            if (request.Role is not null)
            {
                if (!Enum.TryParse<UserRole>(request.Role, ignoreCase: true, out role))
                {
                    return BadRequest("invalid_role", "Role must be 'admin' or 'user'.");
                }
            }

            var disabled = request.Disabled ?? target.Disabled;
            if (target.Role == UserRole.Admin && (role != UserRole.Admin || disabled) && CountAdmins(db) <= 1)
            {
                return Results.Json(new ErrorResponse("last_admin", "The last admin cannot be disabled or demoted."), statusCode: StatusCodes.Status409Conflict);
            }

            // Validate the password before changing anything, so a rejected request leaves the account as it was.
            if (request.Password is not null && PasswordPolicy.Validate(request.Password, target.Username) is { } passwordError)
            {
                return BadRequest("invalid_password", passwordError);
            }

            db.UpdateUserRoleAndDisabled(target.Id, role, disabled);
            if (request.Password is not null)
            {
                db.UpdateUserPassword(target.Id, hasher.Hash(request.Password));
                // A reset password signs the account out everywhere; an admin resetting their own keeps this session.
                db.DeleteSessionsForUser(target.Id, ApiAuth.GetSession(context)?.Id);
                audit.Record(context, AuditActions.UserPasswordReset, targetType: "user", targetId: target.Id, targetName: target.Username,
                    details: "Signed out everywhere");
            }
            if (role != target.Role)
            {
                audit.Record(context, AuditActions.UserRoleChanged, targetType: "user", targetId: target.Id, targetName: target.Username,
                    details: $"{target.Role} → {role}");
            }
            if (disabled != target.Disabled)
            {
                audit.Record(context, disabled ? AuditActions.UserDisabled : AuditActions.UserEnabled, targetType: "user", targetId: target.Id, targetName: target.Username);
            }

            var updated = db.GetUserById(target.Id)!;
            return Results.Ok(AuthEndpoints.ToDto(updated));
        });

        // Deletes an account while protecting the signed-in and last enabled administrator.
        // <param name="id">The route ID of the account to delete.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapDelete("/users/{id}", (string id, HttpContext context, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var current = ApiAuth.GetUser(context)!;
            var target = db.GetUserById(id);
            if (target is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "User not found."));
            }
            if (string.Equals(current.Id, target.Id, StringComparison.Ordinal))
            {
                return Results.Json(new ErrorResponse("cannot_delete_self", "You cannot delete your own account."), statusCode: StatusCodes.Status409Conflict);
            }
            if (target.Role == UserRole.Admin && CountAdmins(db) <= 1)
            {
                return Results.Json(new ErrorResponse("last_admin", "The last admin cannot be deleted."), statusCode: StatusCodes.Status409Conflict);
            }

            db.DeleteUser(target.Id);
            audit.Record(context, AuditActions.UserDeleted, targetType: "user", targetId: target.Id, targetName: target.Username,
                details: $"Role {target.Role}");
            return Results.NoContent();
        });

        // Lists vault file metadata with an option to include deleted files.
        // <param name="includeDeleted">Whether to include soft-deleted vaults.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapGet("/files", (bool includeDeleted, HttpContext context, VaultService vault) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(vault.ListAll(includeDeleted).Select(ToAdminFileDto).ToArray());
        });

        // Validates and stores an uploaded KDBX file under the supplied or original name.
        // <param name="file">The uploaded encrypted KDBX file.</param>
        // <param name="name">An optional vault name to use instead of the uploaded filename.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        // <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
        group.MapPost("/files", async (IFormFile file, string? name, HttpContext context, VaultService vault, AuditLog audit, CancellationToken cancellationToken) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (file is null || file.Length == 0)
            {
                return BadRequest("missing_file", "Upload a .kdbx file.");
            }

            var displayName = string.IsNullOrWhiteSpace(name) ? file.FileName : name;
            byte[] content;
            await using (var memory = new MemoryStream())
            {
                await file.CopyToAsync(memory, cancellationToken);
                content = memory.ToArray();
            }

            try
            {
                var user = ApiAuth.GetUser(context)!;
                var created = await vault.CreateAsync(displayName, content, user, cancellationToken);
                audit.Record(context, AuditActions.VaultUploaded, targetType: "vault", targetId: created.Id, targetName: created.Name,
                    details: $"{created.Size} bytes");
                return Results.Ok(ToAdminFileDto(created));
            }
            catch (VaultValidationException ex)
            {
                return BadRequest("invalid_vault", ex.Message);
            }
            catch (VaultConflictException ex)
            {
                return Results.Json(new ErrorResponse("conflict", ex.Message), statusCode: StatusCodes.Status409Conflict);
            }
        }).DisableAntiforgery();

        // Downloads the encrypted bytes of an active vault for an administrator.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        // <param name="audit">The audit log that records the download.</param>
        group.MapGet("/files/{id}/content", (string id, HttpContext context, VaultService vault, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id, includeDeleted: true);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            var path = vault.GetContentPath(file);
            if (!System.IO.File.Exists(path))
            {
                return Results.NotFound(new ErrorResponse("content_missing", "Vault content is missing on the server."));
            }
            audit.Record(context, AuditActions.VaultDownloaded, targetType: "vault", targetId: file.Id, targetName: file.Name,
                details: $"Revision {file.Revision}");
            return Results.File(path, "application/octet-stream", file.Name, enableRangeProcessing: false);
        });

        // Renames the selected vault without changing its encrypted contents.
        // <param name="id">The vault file ID.</param>
        // <param name="request">The request containing the desired vault filename.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapPatch("/files/{id}", (string id, RenameVaultFileRequest request, HttpContext context, VaultService vault, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            try
            {
                var user = ApiAuth.GetUser(context)!;
                var renamed = vault.Rename(file, request.Name, user);
                if (renamed.Name != file.Name)
                {
                    audit.Record(context, AuditActions.VaultRenamed, targetType: "vault", targetId: file.Id, targetName: renamed.Name,
                        details: $"{file.Name} → {renamed.Name}");
                }
                return Results.Ok(ToAdminFileDto(renamed));
            }
            catch (VaultValidationException ex)
            {
                return BadRequest("invalid_name", ex.Message);
            }
            catch (VaultConflictException ex)
            {
                return Results.Json(new ErrorResponse("conflict", ex.Message), statusCode: StatusCodes.Status409Conflict);
            }
        });

        // Soft-deletes the specified vault.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapDelete("/files/{id}", (string id, HttpContext context, VaultService vault, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            vault.SoftDelete(file);
            audit.Record(context, AuditActions.VaultDeleted, targetType: "vault", targetId: file.Id, targetName: file.Name);
            return Results.NoContent();
        });

        // Restores a soft-deleted vault if its name is available.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapPost("/files/{id}/restore", (string id, HttpContext context, VaultService vault, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id, includeDeleted: true);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            if (file.DeletedAt is null)
            {
                return Results.Json(new ErrorResponse("not_deleted", "Vault file is not deleted."), statusCode: StatusCodes.Status409Conflict);
            }
            try
            {
                vault.Restore(file);
                audit.Record(context, AuditActions.VaultRestored, targetType: "vault", targetId: file.Id, targetName: file.Name);
                return Results.Ok(ToAdminFileDto(vault.Get(id)!));
            }
            catch (VaultConflictException ex)
            {
                return Results.Json(new ErrorResponse("conflict", ex.Message), statusCode: StatusCodes.Status409Conflict);
            }
        });

        // Returns the selected vault's access list and available user accounts.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/files/{id}/permissions", (string id, HttpContext context, VaultService vault, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id, includeDeleted: true);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            var permissions = vault.ListPermissions(file.Id)
                .Select(/* Exposes each current grant with its username and API permission value.
                 * <param name="p">One stored permission record from the vault's access list.</param>
                 */ p => new { p.UserId, Username = p.Username, Permission = p.Permission.ToString().ToLowerInvariant().Replace("readwrite", "read-write"), p.UpdatedAt })
                .ToArray();
            return Results.Ok(permissions);
        });

        // Validates and replaces the complete access list for the selected vault.
        // <param name="id">The vault file ID.</param>
        // <param name="request">The complete replacement permissions for the vault.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapPut("/files/{id}/permissions", (string id, SetPermissionsRequest request, HttpContext context, VaultService vault, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }

            var replacements = new List<(string UserId, VaultPermission Permission)>();
            var names = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var input in request.Permissions ?? Array.Empty<PermissionInput>())
            {
                var user = db.GetUserById(input.UserId);
                if (user is null || user.Disabled)
                {
                    return Results.Json(new ErrorResponse("invalid_user", $"Unknown or disabled user '{input.UserId}'."), statusCode: StatusCodes.Status400BadRequest);
                }
                var permission = input.Permission?.Trim().ToLowerInvariant() switch
                {
                    "read" => VaultPermission.Read,
                    "read-write" or "readwrite" => VaultPermission.ReadWrite,
                    _ => (VaultPermission?)null
                };
                if (permission is null)
                {
                    return BadRequest("invalid_permission", "Permission must be 'read' or 'read-write'.");
                }
                replacements.Add((user.Id, permission.Value));
                names[user.Id] = user.Username;
            }

            var before = vault.ListPermissions(file.Id);
            vault.ReplacePermissions(file.Id, replacements);
            var changes = DescribePermissionChanges(before, replacements, names);
            if (changes.Length > 0)
            {
                audit.Record(context, AuditActions.VaultPermissionsChanged, targetType: "vault", targetId: file.Id, targetName: file.Name, details: changes);
            }
            return Results.Ok(vault.ListPermissions(file.Id)
                .Select(/* Serializes the stored grants after replacing the access list.
                 * <param name="p">One permission record read back after saving.</param>
                 */ p => new { p.UserId, Username = p.Username, Permission = p.Permission.ToString().ToLowerInvariant().Replace("readwrite", "read-write"), p.UpdatedAt })
                .ToArray());
        });

        // Lists the retained WebDAV request log, newest first, for administrators.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/logs/webdav", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(db.ListWebDavRequestLog());
        });

        // Lists WebDAV credential metadata for administrators.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // Lists the current revision and the kept earlier versions of a vault.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service that keeps and lists versions.</param>
        group.MapGet("/files/{id}/versions", (string id, HttpContext context, VaultService vault) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id, includeDeleted: true);
            return file is null
                ? Results.NotFound(new ErrorResponse("not_found", "Vault file not found."))
                : Results.Ok(vault.ListVersions(file));
        });

        // Downloads one kept earlier version, named e.g. family-r37.kdbx.
        // <param name="id">The vault file ID.</param>
        // <param name="revision">The revision number.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service that keeps versions.</param>
        // <param name="audit">The audit log that records the download.</param>
        group.MapGet("/files/{id}/versions/{revision:long}/content", (string id, long revision, HttpContext context, VaultService vault, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id, includeDeleted: true);
            var path = file is null ? null : vault.GetVersionPath(file.Id, revision);
            if (file is null || revision >= file.Revision || !System.IO.File.Exists(path))
            {
                return Results.NotFound(new ErrorResponse("not_found", "Version not found."));
            }
            audit.Record(context, AuditActions.VaultDownloaded, targetType: "vault", targetId: file.Id, targetName: file.Name,
                details: $"Earlier version, revision {revision}");
            var baseName = file.Name.EndsWith(".kdbx", StringComparison.OrdinalIgnoreCase) ? file.Name[..^5] : file.Name;
            return Results.File(path!, "application/octet-stream", $"{baseName}-r{revision}.kdbx", enableRangeProcessing: false);
        });

        // Restores an earlier version as a new revision; the state before stays available as a version.
        // <param name="id">The vault file ID.</param>
        // <param name="revision">The revision to restore.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service that keeps and restores versions.</param>
        // <param name="audit">The audit log that records the restore.</param>
        // <param name="cancellationToken">A token that cancels the operation.</param>
        group.MapPost("/files/{id}/versions/{revision:long}/restore", async (string id, long revision, HttpContext context, VaultService vault, AuditLog audit, CancellationToken cancellationToken) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var before = vault.Get(id);
            if (before is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            try
            {
                var restored = await vault.RestoreVersionAsync(id, revision, ApiAuth.GetUser(context)!, cancellationToken);
                if (restored is null)
                {
                    return Results.NotFound(new ErrorResponse("not_found", "Version not found."));
                }
                audit.Record(context, AuditActions.VaultVersionRestored, targetType: "vault", targetId: restored.Id, targetName: restored.Name,
                    details: $"Revision {revision} restored as revision {restored.Revision}");
                return Results.Ok(ToAdminFileDto(restored));
            }
            catch (VaultValidationException ex)
            {
                return BadRequest("invalid_vault", ex.Message);
            }
            catch (VaultVersionException ex)
            {
                return VaultEndpoints.VersionFailed(context, ex);
            }
        });

        // Returns how many earlier versions are kept and how much space they use.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/settings/versions", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var (maxCount, maxDays) = db.GetVersionSettings();
            return Results.Ok(new VersionSettingsDto(maxCount, maxDays, db.GetArchivedRevisionBytes()));
        });

        // Changes how many earlier versions are kept; versions beyond the new limits are removed right away.
        // <param name="request">The new limits.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="vault">The service that removes versions beyond the limits.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/settings/versions", (VersionSettingsDto request, HttpContext context, KeePortDb db, VaultService vault, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (request.MaxCount is < 0 or > 1000 || request.MaxDays is < 0 or > 3650)
            {
                return BadRequest("invalid_versions", "Keep 0 to 1000 versions for 0 to 3650 days (0 days: no age limit).");
            }
            var (beforeCount, beforeDays) = db.GetVersionSettings();
            db.SetVersionSettings(request.MaxCount, request.MaxDays);
            vault.PruneAllVersions();
            if (beforeCount != request.MaxCount || beforeDays != request.MaxDays)
            {
                audit.Record(context, AuditActions.VersionSettingsChanged, targetType: "settings", targetName: "Vault versions",
                    details: $"{beforeCount} → {request.MaxCount} versions, {beforeDays} → {request.MaxDays} days");
            }
            return Results.Ok(new VersionSettingsDto(request.MaxCount, request.MaxDays, db.GetArchivedRevisionBytes()));
        });

        // Lists one page of the audit log with its headline counts and the known action tags.
        // <param name="context">The current HTTP request, carrying the filters as query parameters.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/logs/audit", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (ReadAuditFilter(context.Request.Query, out var filter) is { } invalid)
            {
                return invalid;
            }
            var page = Math.Max(1, ReadInt(context.Request.Query, "page", 1));
            var pageSize = Math.Clamp(ReadInt(context.Request.Query, "pageSize", 25), 10, 200);
            var (items, total) = db.QueryAudit(filter, page, pageSize);
            return Results.Ok(new AuditPageDto(items, total, page, pageSize, db.GetAuditStats(DateTimeOffset.UtcNow), AuditActions.All));
        });

        // Exports the audit entries matching the filters as CSV.
        // <param name="context">The current HTTP request, carrying the filters as query parameters.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/logs/audit.csv", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (ReadAuditFilter(context.Request.Query, out var filter) is { } invalid)
            {
                return invalid;
            }
            var csv = AuditCsv.Write(db.ListAudit(filter));
            var fileName = $"keeport-audit-log-{DateTimeOffset.UtcNow:yyyy-MM-dd}.csv";
            return Results.File(System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(csv)).ToArray(), "text/csv; charset=utf-8", fileName);
        });

        // Returns how long audit log entries are kept.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="audit">The audit log with its retention.</param>
        group.MapGet("/settings/audit", (HttpContext context, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(new AuditSettingsDto(audit.RetentionDays));
        });

        // Changes how long audit log entries are kept; older entries are removed right away.
        // <param name="request">The new retention in days.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="audit">The audit log with its retention.</param>
        group.MapPut("/settings/audit", (AuditSettingsDto request, HttpContext context, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (request.RetentionDays is < 1 or > 3650)
            {
                return BadRequest("invalid_retention", "Keep entries between 1 and 3650 days.");
            }
            var before = audit.RetentionDays;
            audit.SetRetentionDays(request.RetentionDays);
            if (before != request.RetentionDays)
            {
                audit.Record(context, AuditActions.AuditRetentionChanged, targetType: "settings", targetName: "Audit log",
                    details: $"{before} → {request.RetentionDays} days");
            }
            return Results.Ok(new AuditSettingsDto(audit.RetentionDays));
        });

        group.MapGet("/webdav-credentials", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(db.ListWebDavCredentials().Select(ToWebDavDto).ToArray());
        });

        // Creates a uniquely named WebDAV credential for an eligible user.
        // <param name="request">The owner, label, and password for the new credential.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
        group.MapPost("/webdav-credentials", (CreateWebDavCredentialRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var user = db.GetUserById(request.UserId);
            if (user is null || user.Disabled || user.Role != UserRole.User)
            {
                return BadRequest("invalid_user", "WebDAV credentials require an active Vault user account.");
            }
            if (string.IsNullOrWhiteSpace(request.Label) || request.Label.Trim().Length > 100)
            {
                return BadRequest("invalid_label", "Label is required and must be at most 100 characters.");
            }
            var passwordError = PasswordPolicy.Validate(request.Password, user.Username);
            if (passwordError is not null)
            {
                return BadRequest("invalid_password", passwordError);
            }

            var username = GenerateWebDavUsername(db, user.Username, request.Label.Trim());
            var credential = new WebDavCredentialRecord
            {
                Id = Guid.NewGuid().ToString("N"),
                UserId = user.Id,
                Username = username,
                Label = request.Label.Trim(),
                PasswordHash = hasher.Hash(request.Password),
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.CreateWebDavCredential(credential);
            audit.Record(context, AuditActions.AppPasswordCreated, targetType: "appPassword", targetId: credential.Id, targetName: credential.Username,
                details: $"{credential.Label} for {user.Username}");
            return Results.Ok(ToWebDavDto(credential));
        });

        // Revokes an active WebDAV credential.
        // <param name="id">The route ID of the credential to revoke.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapDelete("/webdav-credentials/{id}", (string id, HttpContext context, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var credential = db.ListWebDavCredentials().FirstOrDefault(/* Matches only unrevoked credentials with the requested ID.
             * <param name="c">A candidate WebDAV credential to check for a matching ID.</param>
             */ c => c.Id == id && c.RevokedAt is null);
            if (credential is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "WebDAV credential not found."));
            }
            db.RevokeWebDavCredential(id, DateTimeOffset.UtcNow);
            audit.Record(context, AuditActions.AppPasswordRevoked, targetType: "appPassword", targetId: credential.Id, targetName: credential.Username,
                details: credential.Label);
            return Results.NoContent();
        });
    }

    /// <summary>Counts enabled administrator accounts.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    private static int CountAdmins(KeePortDb db) => db.ListUsers().Count(/* Includes only enabled users with the admin role.
     * <param name="u">A stored account whose role and enabled state are checked.</param>
     */ u => u.Role == UserRole.Admin && !u.Disabled);

    /// <summary>Reads the audit log filters from the query string.</summary>
    /// <param name="query">The query parameters actor, action, category, from, to, failedOnly and search.</param>
    /// <param name="filter">The filter that was read.</param>
    /// <returns>An error result for an invalid date, otherwise null.</returns>
    private static IResult? ReadAuditFilter(IQueryCollection query, out AuditFilter filter)
    {
        filter = new AuditFilter();
        DateTimeOffset? from = null, to = null;
        foreach (var (key, target) in new[] { ("from", 0), ("to", 1) })
        {
            var text = query[key].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }
            if (!DateTimeOffset.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var value))
            {
                return BadRequest("invalid_date", $"'{key}' must be a date and time such as 2026-11-26T00:00:00+01:00.");
            }
            if (target == 0) from = value; else to = value;
        }
        filter = new AuditFilter(
            query["actor"].FirstOrDefault(),
            query["action"].FirstOrDefault(),
            query["category"].FirstOrDefault(),
            from,
            to,
            string.Equals(query["failedOnly"].FirstOrDefault(), "true", StringComparison.OrdinalIgnoreCase),
            query["search"].FirstOrDefault());
        return null;
    }

    /// <summary>Reads a whole number from the query string, or a default when it is missing or invalid.</summary>
    /// <param name="query">The query parameters.</param>
    /// <param name="key">The parameter name.</param>
    /// <param name="fallback">The value to use when the parameter is missing or invalid.</param>
    private static int ReadInt(IQueryCollection query, string key, int fallback)
        => int.TryParse(query[key].FirstOrDefault(), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : fallback;

    /// <summary>Describes how the permissions of a vault changed, e.g. "anna: none → read-write; ben: read → none".</summary>
    /// <param name="before">The permissions before the change.</param>
    /// <param name="after">The new permissions.</param>
    /// <param name="names">Usernames of the accounts in <paramref name="after"/>.</param>
    private static string DescribePermissionChanges(
        IReadOnlyList<VaultPermissionRecord> before,
        IReadOnlyList<(string UserId, VaultPermission Permission)> after,
        IReadOnlyDictionary<string, string> names)
    {
        // Names a permission the way the admin console shows it.
        static string Label(VaultPermission? permission) => permission switch
        {
            VaultPermission.Read => "read",
            VaultPermission.ReadWrite => "read-write",
            _ => "none"
        };

        var old = before.ToDictionary(/* Account. */ p => p.UserId, /* Grant. */ p => (Permission: (VaultPermission?)p.Permission, Name: p.Username ?? p.UserId));
        var current = after.ToDictionary(/* Account. */ p => p.UserId, /* Grant. */ p => (VaultPermission?)p.Permission);
        var changes = new List<string>();
        foreach (var userId in old.Keys.Union(current.Keys).OrderBy(/* Stable order. */ id => names.GetValueOrDefault(id) ?? old.GetValueOrDefault(id).Name, StringComparer.OrdinalIgnoreCase))
        {
            var from = old.TryGetValue(userId, out var o) ? o.Permission : null;
            var to = current.GetValueOrDefault(userId);
            if (from != to)
            {
                var name = names.GetValueOrDefault(userId) ?? o.Name ?? userId;
                changes.Add($"{name}: {Label(from)} → {Label(to)}");
            }
        }
        return string.Join("; ", changes);
    }

    /// <summary>Builds a structured HTTP 400 response with a KeePort error code.</summary>
    /// <param name="code">The stable error code clients can use to identify the failure.</param>
    /// <param name="message">The human-readable description of the failure.</param>
    private static IResult BadRequest(string code, string message) => Results.Json(new ErrorResponse(code, message), statusCode: StatusCodes.Status400BadRequest);

    /// <summary>Builds an available WebDAV username from the account name and credential label.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="username">The owner username used to form the credential name.</param>
    /// <param name="label">The credential label used to form a readable login name.</param>
    private static string GenerateWebDavUsername(KeePortDb db, string username, string label)
    {
        var builder = new StringBuilder();
        foreach (var ch in $"{username}-{label}".ToLowerInvariant())
        {
            builder.Append(char.IsLetterOrDigit(ch) ? ch : '-');
        }
        var baseName = builder.ToString().Trim('-');
        if (baseName.Length == 0)
        {
            baseName = "webdav";
        }
        if (baseName.Length > 48)
        {
            baseName = baseName[..48].Trim('-');
        }

        var candidate = baseName;
        var suffix = 0;
        while (db.WebDavUsernameExists(candidate))
        {
            suffix++;
            candidate = $"{baseName}-{suffix}";
        }
        return candidate;
    }

    /// <summary>Converts vault metadata for the Admin API, marking only active vaults as writable.</summary>
    /// <param name="file">The vault metadata to expose with admin-specific access flags.</param>
    private static VaultFileDto ToAdminFileDto(VaultFileRecord file)
    {
        var dto = VaultEndpoints.ToDto(file with { Permission = file.DeletedAt is null ? "read-write" : "none" });
        return dto with { Permission = file.DeletedAt is null ? "read-write" : "none" };
    }

    /// <summary>Projects a stored WebDAV credential into its API representation without its hash.</summary>
    /// <param name="credential">The WebDAV credential metadata.</param>
    private static WebDavCredentialDto ToWebDavDto(WebDavCredentialRecord credential)
    {
        return new WebDavCredentialDto(credential.Id, credential.UserId, credential.Username, credential.Label, credential.CreatedAt, credential.LastUsedAt, credential.RevokedAt);
    }
}
