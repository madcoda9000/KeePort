using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup(SessionService.AdminApiPath + "/auth").RequireRateLimiting("auth");
        var vault = app.MapGroup("/api/auth").RequireRateLimiting("auth");
        MapAccountEndpoints(admin, UserRole.Admin);
        MapAccountEndpoints(vault, UserRole.User);

        admin.MapGet("/setup-status", (KeePortDb db) =>
        {
            var hasAdmin = db.HasAdmin();
            var hasUsers = db.ListUsers().Count > 0;
            var setupToken = db.GetSetupToken();
            return Results.Ok(new SetupStatusResponse(RequiresSetup: !hasAdmin && setupToken is not null, HasUsers: hasUsers));
        });

        admin.MapPost("/setup", (SetupRequest request, KeePortDb db, PasswordHasher hasher, SessionService sessions, IConfiguration configuration, HttpContext context) =>
        {
            if (db.HasAdmin())
            {
                return Results.Json(new ErrorResponse("setup_closed", "Initial setup has already been completed."), statusCode: StatusCodes.Status409Conflict);
            }

            var expectedToken = db.GetSetupToken();
            if (string.IsNullOrEmpty(expectedToken) || !FixedTimeEquals(expectedToken, request.SetupToken))
            {
                return Results.Json(new ErrorResponse("invalid_setup_token", "Setup token is invalid."), statusCode: StatusCodes.Status403Forbidden);
            }

            var usernameError = PasswordPolicy.ValidateUsername(request.Username);
            if (usernameError is not null)
            {
                return Results.Json(new ErrorResponse("invalid_username", usernameError), statusCode: StatusCodes.Status400BadRequest);
            }
            var passwordError = PasswordPolicy.Validate(request.Password, request.Username);
            if (passwordError is not null)
            {
                return Results.Json(new ErrorResponse("invalid_password", passwordError), statusCode: StatusCodes.Status400BadRequest);
            }
            var email = EmailAddress.Normalize(request.Email);
            if (email is null)
            {
                return Results.Json(new ErrorResponse("invalid_email", "Enter a valid email address."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (db.GetUserByUsername(request.Username.Trim()) is not null)
            {
                return Results.Json(new ErrorResponse("username_taken", "Username is already in use."), statusCode: StatusCodes.Status409Conflict);
            }

            var now = DateTimeOffset.UtcNow;
            var user = new UserRecord
            {
                Id = Guid.NewGuid().ToString("N"),
                Username = request.Username.Trim(),
                Email = email,
                PasswordHash = hasher.Hash(request.Password),
                Role = UserRole.Admin,
                Disabled = false,
                CreatedAt = now
            };
            db.CreateUser(user);
            db.ClearSetupToken();

            var (_, token, csrfToken) = sessions.CreateSession(user, context);
            sessions.SetSessionCookie(context, token, UserRole.Admin, configuration.GetValue("KeePort:CookieSecure", true));
            return Results.Ok(new AuthResponse(ToDto(user), csrfToken));
        });

        vault.MapPut("/settings", (UpdateSettingsRequest request, HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            if (request.AutoLockMinutes is < 1 or > 1440)
            {
                return Results.Json(new ErrorResponse("invalid_settings", "Auto-lock minutes must be between 1 and 1440."), statusCode: StatusCodes.Status400BadRequest);
            }
            db.UpdateUserAutoLockMinutes(user.Id, request.AutoLockMinutes);
            return Results.Ok(ToDto(db.GetUserById(user.Id)!));
        });
    }

    /// <summary>Maps sign-in and self-service endpoints for one account role.</summary>
    private static void MapAccountEndpoints(RouteGroupBuilder group, UserRole role)
    {
        group.MapPost("/login", (LoginRequest request, KeePortDb db, PasswordHasher hasher, SessionService sessions, IConfiguration configuration, HttpContext context) =>
        {
            var user = db.GetUserByUsername(request.Username ?? string.Empty);
            if (user is null || user.Role != role || user.Disabled || !hasher.Verify(request.Password ?? string.Empty, user.PasswordHash))
            {
                return Results.Json(new ErrorResponse("invalid_credentials", "Invalid username or password."), statusCode: StatusCodes.Status401Unauthorized);
            }

            db.UpdateLastLogin(user.Id, DateTimeOffset.UtcNow);
            var (_, token, csrfToken) = sessions.CreateSession(user, context);
            sessions.SetSessionCookie(context, token, role, configuration.GetValue("KeePort:CookieSecure", true));
            return Results.Ok(new AuthResponse(ToDto(user), csrfToken));
        });

        group.MapPost("/logout", (HttpContext context, KeePortDb db, SessionService sessions, IConfiguration configuration) =>
        {
            if (ApiAuth.GetSession(context) is { } session)
            {
                db.DeleteSessionByTokenHash(session.TokenHash);
            }
            sessions.ClearSessionCookie(context, role, configuration.GetValue("KeePort:CookieSecure", true));
            return Results.NoContent();
        });

        group.MapGet("/me", (HttpContext context) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            return Results.Ok(ToDto(user));
        });

        group.MapGet("/csrf", (HttpContext context) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var session = ApiAuth.GetSession(context)!;
            return Results.Ok(new { csrfToken = session.CsrfToken });
        });

        group.MapPost("/change-password", (ChangePasswordRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            if (string.IsNullOrEmpty(request.CurrentPassword) || !hasher.Verify(request.CurrentPassword, user.PasswordHash))
            {
                return Results.Json(new ErrorResponse("invalid_password", "Current password is incorrect."), statusCode: StatusCodes.Status403Forbidden);
            }
            var passwordError = PasswordPolicy.Validate(request.NewPassword, user.Username);
            if (passwordError is not null)
            {
                return Results.Json(new ErrorResponse("invalid_password", passwordError), statusCode: StatusCodes.Status400BadRequest);
            }
            db.UpdateUserPassword(user.Id, hasher.Hash(request.NewPassword));
            return Results.NoContent();
        });

        group.MapPut("/email", UpdateEmail);
    }

    /// <summary>Validates and changes the authenticated account's contact email.</summary>
    private static IResult UpdateEmail(UpdateEmailRequest request, HttpContext context, KeePortDb db)
    {
        if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
        {
            return unauthorized;
        }
        var email = EmailAddress.Normalize(request.Email);
        if (email is null)
        {
            return Results.Json(new ErrorResponse("invalid_email", "Enter a valid email address."), statusCode: StatusCodes.Status400BadRequest);
        }
        var user = ApiAuth.GetUser(context)!;
        db.UpdateUserEmail(user.Id, email);
        return Results.Ok(ToDto(db.GetUserById(user.Id)!));
    }

    internal static UserDto ToDto(UserRecord user)
    {
        return new UserDto(user.Id, user.Username, user.Role.ToString().ToLowerInvariant(), user.Disabled, user.CreatedAt, user.LastLoginAt, user.AutoLockMinutes, user.Email);
    }

    private static bool FixedTimeEquals(string expected, string actual)
    {
        var expectedBytes = System.Text.Encoding.UTF8.GetBytes(expected);
        var actualBytes = System.Text.Encoding.UTF8.GetBytes(actual ?? string.Empty);
        return expectedBytes.Length == actualBytes.Length && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes);
    }
}
