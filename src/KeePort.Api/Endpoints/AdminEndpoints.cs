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
        group.MapPut("/settings/rate-limits", (RateLimitSettings request, HttpContext context, RateLimitSettingsService settings) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (request.AuthPerMinute <= 0 || request.WebDavPerMinute <= 0)
            {
                return BadRequest("invalid_rate_limit", "Both limits must be positive whole numbers.");
            }
            settings.Update(request);
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
        group.MapPost("/users", (CreateUserRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher) =>
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
            return Results.Ok(AuthEndpoints.ToDto(user));
        });

        // Updates the role, disabled status, or password without removing the last enabled administrator.
        // <param name="id">The route ID of the account to update.</param>
        // <param name="request">The requested account changes; omitted fields are unchanged.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
        group.MapPatch("/users/{id}", (string id, UpdateUserRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher) =>
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
            }

            var updated = db.GetUserById(target.Id)!;
            return Results.Ok(AuthEndpoints.ToDto(updated));
        });

        // Deletes an account while protecting the signed-in and last enabled administrator.
        // <param name="id">The route ID of the account to delete.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapDelete("/users/{id}", (string id, HttpContext context, KeePortDb db) =>
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
        group.MapPost("/files", async (IFormFile file, string? name, HttpContext context, VaultService vault, CancellationToken cancellationToken) =>
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
        group.MapGet("/files/{id}/content", (string id, HttpContext context, VaultService vault) =>
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
            return Results.File(path, "application/octet-stream", file.Name, enableRangeProcessing: false);
        });

        // Renames the selected vault without changing its encrypted contents.
        // <param name="id">The vault file ID.</param>
        // <param name="request">The request containing the desired vault filename.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapPatch("/files/{id}", (string id, RenameVaultFileRequest request, HttpContext context, VaultService vault) =>
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
        group.MapDelete("/files/{id}", (string id, HttpContext context, VaultService vault) =>
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
            return Results.NoContent();
        });

        // Restores a soft-deleted vault if its name is available.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapPost("/files/{id}/restore", (string id, HttpContext context, VaultService vault) =>
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
        group.MapPut("/files/{id}/permissions", (string id, SetPermissionsRequest request, HttpContext context, VaultService vault, KeePortDb db) =>
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
            }

            vault.ReplacePermissions(file.Id, replacements);
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
        group.MapPost("/webdav-credentials", (CreateWebDavCredentialRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher) =>
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
            return Results.Ok(ToWebDavDto(credential));
        });

        // Revokes an active WebDAV credential.
        // <param name="id">The route ID of the credential to revoke.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapDelete("/webdav-credentials/{id}", (string id, HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var exists = db.ListWebDavCredentials().Any(/* Matches only unrevoked credentials with the requested ID.
             * <param name="c">A candidate WebDAV credential to check for a matching ID.</param>
             */ c => c.Id == id && c.RevokedAt is null);
            if (!exists)
            {
                return Results.NotFound(new ErrorResponse("not_found", "WebDAV credential not found."));
            }
            db.RevokeWebDavCredential(id, DateTimeOffset.UtcNow);
            return Results.NoContent();
        });
    }

    /// <summary>Counts enabled administrator accounts.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    private static int CountAdmins(KeePortDb db) => db.ListUsers().Count(/* Includes only enabled users with the admin role.
     * <param name="u">A stored account whose role and enabled state are checked.</param>
     */ u => u.Role == UserRole.Admin && !u.Disabled);

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
