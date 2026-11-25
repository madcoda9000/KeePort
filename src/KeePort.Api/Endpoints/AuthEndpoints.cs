using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

public static class AuthEndpoints
{
    public const string CredentialRateLimitPolicy = "auth-credentials";

    /// <summary>Registers separate admin and vault authentication routes, plus setup and user preferences.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup(SessionService.AdminApiPath + "/auth");
        var vault = app.MapGroup("/api/auth");
        MapAccountEndpoints(admin, UserRole.Admin);
        MapAccountEndpoints(vault, UserRole.User);

        // Reports whether initial admin setup is still needed and whether any users exist.
        // <param name="db">The SQLite store for KeePort metadata.</param>
        admin.MapGet("/setup-status", (KeePortDb db) =>
        {
            var hasAdmin = db.HasAdmin();
            var hasUsers = db.ListUsers().Count > 0;
            var setupToken = db.GetSetupToken();
            return Results.Ok(new SetupStatusResponse(RequiresSetup: !hasAdmin && setupToken is not null, HasUsers: hasUsers));
        });

        // Validates the one-time setup token and creates the first administrator account.
        // <param name="request">The one-time token and first administrator's account details.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
        // <param name="sessions">The service for managing sessions, cookies, and CSRF tokens.</param>
        // <param name="configuration">The configuration used to select the session cookie security options.</param>
        // <param name="context">The current HTTP request and response context.</param>
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
            sessions.SetSessionCookie(context, token, UserRole.Admin, ConfigFlags.CookieSecure(configuration) || context.Request.IsHttps);
            return Results.Ok(new AuthResponse(ToDto(user), csrfToken));
        }).RequireRateLimiting(CredentialRateLimitPolicy);

        // Updates the signed-in vault user's preferences; fields left out stay unchanged.
        // <param name="request">The update containing the auto-lock, website icon and clipboard preferences.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
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
            if (request.ClipboardClearSeconds is < 0 or > 600)
            {
                return Results.Json(new ErrorResponse("invalid_settings", "Clipboard clearing must be between 0 (off) and 600 seconds."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (request.AutoLockMinutes is { } minutes)
            {
                db.UpdateUserAutoLockMinutes(user.Id, minutes);
            }
            if (request.ShowFavicons is { } showFavicons)
            {
                db.UpdateUserShowFavicons(user.Id, showFavicons);
            }
            if (request.ClipboardClearSeconds is { } seconds)
            {
                db.UpdateUserClipboardClearSeconds(user.Id, seconds);
            }
            return Results.Ok(ToDto(db.GetUserById(user.Id)!));
        });
    }

    /// <summary>Maps sign-in and self-service endpoints for one account role.</summary>
    /// <param name="group">The route group for the account type.</param>
    /// <param name="role">The user role handled by this group.</param>
    private static void MapAccountEndpoints(RouteGroupBuilder group, UserRole role)
    {
        // Checks credentials for the required role and issues that application's session cookie.
        // <param name="request">The username and password submitted for sign-in.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
        // <param name="sessions">The service for managing sessions, cookies, and CSRF tokens.</param>
        // <param name="configuration">The configuration used to select the session cookie security options.</param>
        // <param name="context">The current HTTP request and response context.</param>
        group.MapPost("/login", (LoginRequest request, KeePortDb db, PasswordHasher hasher, SessionService sessions, IConfiguration configuration, HttpContext context) =>
        {
            var user = db.GetUserByUsername(request.Username ?? string.Empty);
            if (user is null || user.Role != role || user.Disabled || !hasher.Verify(request.Password ?? string.Empty, user.PasswordHash))
            {
                CountLogin(db, context, role, success: false);
                return Results.Json(new ErrorResponse("invalid_credentials", "Invalid username or password."), statusCode: StatusCodes.Status401Unauthorized);
            }

            CountLogin(db, context, role, success: true);
            db.UpdateLastLogin(user.Id, DateTimeOffset.UtcNow);
            var (_, token, csrfToken) = sessions.CreateSession(user, context);
            sessions.SetSessionCookie(context, token, role, ConfigFlags.CookieSecure(configuration) || context.Request.IsHttps);
            return Results.Ok(new AuthResponse(ToDto(user), csrfToken));
        }).RequireRateLimiting(CredentialRateLimitPolicy);

        // Removes the current session and clears the cookie for the selected role.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="sessions">The service for managing sessions, cookies, and CSRF tokens.</param>
        // <param name="configuration">The configuration used to select the session cookie security options.</param>
        group.MapPost("/logout", (HttpContext context, KeePortDb db, SessionService sessions, IConfiguration configuration) =>
        {
            if (ApiAuth.GetSession(context) is { } session)
            {
                db.DeleteSessionByTokenHash(session.TokenHash);
            }
            sessions.ClearSessionCookie(context, role, ConfigFlags.CookieSecure(configuration) || context.Request.IsHttps);
            return Results.NoContent();
        });

        // Returns the signed-in user's account details.
        // <param name="context">The current HTTP request and response context.</param>
        group.MapGet("/me", (HttpContext context) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            return Results.Ok(ToDto(user));
        });

        // Returns the CSRF token for the current session.
        // <param name="context">The current HTTP request and response context.</param>
        group.MapGet("/csrf", (HttpContext context) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var session = ApiAuth.GetSession(context)!;
            return Results.Ok(new { csrfToken = session.CsrfToken });
        });

        // Verifies the current password and stores a hash of the validated replacement.
        // <param name="request">The current password and the replacement password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing and verifying passwords.</param>
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
    /// <param name="request">The update containing the replacement contact email.</param>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
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

    /// <summary>Converts a stored user into its public API representation without the password hash.</summary>
    /// <param name="user">The user account associated with the operation.</param>
    internal static UserDto ToDto(UserRecord user)
    {
        return new UserDto(user.Id, user.Username, user.Role.ToString().ToLowerInvariant(), user.Disabled, user.CreatedAt, user.LastLoginAt, user.AutoLockMinutes, user.Email, user.ShowFavicons, user.ClipboardClearSeconds);
    }

    /// <summary>
    /// Counts a sign-in for the admin dashboard. A failure to count is logged and never changes the sign-in result.
    /// </summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="context">The current HTTP request, used for logging.</param>
    /// <param name="role">The role of the sign-in endpoint: Admin for the admin console, User for the web vault.</param>
    /// <param name="success">Whether the sign-in succeeded.</param>
    private static void CountLogin(KeePortDb db, HttpContext context, UserRole role, bool success)
    {
        try
        {
            db.RecordLogin(role == UserRole.Admin ? LoginChannel.Admin : LoginChannel.Vault, success, DateTimeOffset.UtcNow);
        }
        catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException)
        {
            context.RequestServices.GetService<ILoggerFactory>()?.CreateLogger("KeePort.Api").LogWarning(ex, "Could not count a sign-in for the dashboard.");
        }
    }

    /// <summary>Compares two UTF-8 token values using constant-time byte comparison.</summary>
    /// <param name="expected">The reference token value.</param>
    /// <param name="actual">The token supplied by the request.</param>
    private static bool FixedTimeEquals(string expected, string actual)
    {
        var expectedBytes = System.Text.Encoding.UTF8.GetBytes(expected);
        var actualBytes = System.Text.Encoding.UTF8.GetBytes(actual ?? string.Empty);
        return expectedBytes.Length == actualBytes.Length && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes);
    }
}
