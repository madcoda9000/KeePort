using System.Text;
using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin");

        group.MapGet("/settings/rate-limits", (HttpContext context, RateLimitSettingsService settings) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(settings.Current.Settings);
        });

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

        group.MapGet("/users", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(db.ListUsers().Select(AuthEndpoints.ToDto).ToArray());
        });

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

            db.UpdateUserRoleAndDisabled(target.Id, role, disabled);
            if (request.Password is not null)
            {
                var passwordError = PasswordPolicy.Validate(request.Password, target.Username);
                if (passwordError is not null)
                {
                    return BadRequest("invalid_password", passwordError);
                }
                db.UpdateUserPassword(target.Id, hasher.Hash(request.Password));
            }

            var updated = db.GetUserById(target.Id)!;
            return Results.Ok(AuthEndpoints.ToDto(updated));
        });

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

        group.MapGet("/files", (bool includeDeleted, HttpContext context, VaultService vault) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(vault.ListAll(includeDeleted).Select(ToAdminFileDto).ToArray());
        });

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
                .Select(p => new { p.UserId, Username = p.Username, Permission = p.Permission.ToString().ToLowerInvariant().Replace("readwrite", "read-write"), p.UpdatedAt })
                .ToArray();
            return Results.Ok(permissions);
        });

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
                .Select(p => new { p.UserId, Username = p.Username, Permission = p.Permission.ToString().ToLowerInvariant().Replace("readwrite", "read-write"), p.UpdatedAt })
                .ToArray());
        });

        group.MapGet("/webdav-credentials", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(db.ListWebDavCredentials().Select(ToWebDavDto).ToArray());
        });

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

        group.MapDelete("/webdav-credentials/{id}", (string id, HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var exists = db.ListWebDavCredentials().Any(c => c.Id == id && c.RevokedAt is null);
            if (!exists)
            {
                return Results.NotFound(new ErrorResponse("not_found", "WebDAV credential not found."));
            }
            db.RevokeWebDavCredential(id, DateTimeOffset.UtcNow);
            return Results.NoContent();
        });
    }

    private static int CountAdmins(KeePortDb db) => db.ListUsers().Count(u => u.Role == UserRole.Admin && !u.Disabled);

    private static IResult BadRequest(string code, string message) => Results.Json(new ErrorResponse(code, message), statusCode: StatusCodes.Status400BadRequest);

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

    private static VaultFileDto ToAdminFileDto(VaultFileRecord file)
    {
        var dto = VaultEndpoints.ToDto(file with { Permission = file.DeletedAt is null ? "read-write" : "none" });
        return dto with { Permission = file.DeletedAt is null ? "read-write" : "none" };
    }

    private static WebDavCredentialDto ToWebDavDto(WebDavCredentialRecord credential)
    {
        return new WebDavCredentialDto(credential.Id, credential.UserId, credential.Username, credential.Label, credential.CreatedAt, credential.LastUsedAt, credential.RevokedAt);
    }
}
