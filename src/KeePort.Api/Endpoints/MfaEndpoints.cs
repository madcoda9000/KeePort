using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

/// <summary>
/// Two-factor sign-in: the second step of signing in, the profile settings of both account types, and the
/// administrator's rules and reset.
/// </summary>
public static class MfaEndpoints
{
    /// <summary>Registers all two-factor routes.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapMfaEndpoints(this IEndpointRouteBuilder app)
    {
        MapSignIn(app.MapGroup(SessionService.AdminApiPath + "/auth"), UserRole.Admin);
        MapSignIn(app.MapGroup("/api/auth"), UserRole.User);
        MapAccount(app.MapGroup(SessionService.AdminApiPath + "/auth/mfa"));
        MapAccount(app.MapGroup("/api/auth/mfa"));
        MapAdmin(app.MapGroup(SessionService.AdminApiPath));
    }

    /// <summary>Maps the second step of signing in for one area.</summary>
    /// <param name="group">The auth group of the admin console or the web vault.</param>
    /// <param name="role">The role handled by this group.</param>
    private static void MapSignIn(RouteGroupBuilder group, UserRole role)
    {
        // Checks the second factor of a pending sign-in and, when it is correct, issues the session cookie.
        // <param name="request">The pending sign-in token, the method and the code.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the attempt.</param>
        group.MapPost("/login/mfa", (MfaLoginRequest request, HttpContext context, KeePortDb db, MfaService mfa, AuditLog audit) =>
        {
            var pending = mfa.FindPending(request.MfaToken, role);
            var user = pending is null ? null : db.GetUserById(pending.UserId);
            if (pending is null || user is null || user.Disabled || user.Role != role)
            {
                return Expired();
            }
            var method = request.Method ?? string.Empty;
            var result = mfa.Check(user, method, request.Code);
            if (result == MfaCheck.Valid)
            {
                mfa.Complete(pending);
                var details = method switch
                {
                    MfaMethods.Totp => "Second factor: authenticator app",
                    MfaMethods.Email => "Second factor: e-mail code",
                    _ => $"Second factor: recovery code ({mfa.RecoveryCodesLeft(user.Id)} left)"
                };
                return AuthEndpoints.CompleteSignIn(context, user, role, details);
            }
            if (result == MfaCheck.MethodNotAvailable)
            {
                return Results.Json(new ErrorResponse("mfa_method_unavailable", "This method is not available for your account."), statusCode: StatusCodes.Status400BadRequest);
            }
            var stillValid = mfa.CountFailure(pending);
            AuthEndpoints.RecordFailedLogin(context, db, audit, role, user, user.Username, method switch
            {
                MfaMethods.Totp => "Wrong code from the authenticator app",
                MfaMethods.Email => "Wrong e-mail code",
                _ => "Wrong recovery code"
            });
            return stillValid
                ? Results.Json(new ErrorResponse("wrong_code", "The code is wrong."), statusCode: StatusCodes.Status401Unauthorized)
                : Results.Json(new ErrorResponse("mfa_too_many_attempts", "Too many wrong codes. Sign in again."), statusCode: StatusCodes.Status401Unauthorized);
        }).RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);

        // Sends a sign-in code by e-mail for a pending sign-in; at most one per minute and five per hour.
        // <param name="request">The pending sign-in token.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="queue">The e-mail queue.</param>
        group.MapPost("/login/mfa/email", (MfaEmailCodeRequest request, KeePortDb db, MfaService mfa, EmailQueue queue) =>
        {
            var pending = mfa.FindPending(request.MfaToken, role);
            var user = pending is null ? null : db.GetUserById(pending.UserId);
            if (pending is null || user is null || user.Disabled)
            {
                return Expired();
            }
            if (!mfa.Methods(user).Contains(MfaMethods.Email))
            {
                return Results.Json(new ErrorResponse("mfa_method_unavailable", "This method is not available for your account."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (!queue.IsConfigured)
            {
                return Results.Json(new ErrorResponse("email_not_configured", "E-mail is not set up on this server yet. Ask your administrator."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (mfa.CreateEmailCode(user.Id) is not { } code)
            {
                return Results.Json(new ErrorResponse("too_many_codes", "Wait a minute before asking for a new code."), statusCode: StatusCodes.Status429TooManyRequests);
            }
            queue.Enqueue(EmailTemplates.Kinds.MfaCode, user.Email!, user.Language, new Dictionary<string, string> { ["username"] = user.Username, ["code"] = code });
            return Results.NoContent();
        }).RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);
    }

    /// <summary>Maps the profile routes of the signed-in account.</summary>
    /// <param name="group">The mfa group of the admin console or the web vault.</param>
    private static void MapAccount(RouteGroupBuilder group)
    {
        // Returns the account's two-factor state.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        group.MapGet("", (HttpContext context, MfaService mfa) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            return Results.Ok(Status(mfa, ApiAuth.GetUser(context)!));
        });

        // Starts setting up an authenticator app after checking the password; returns the secret and the QR link.
        // <param name="request">The account password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        group.MapPost("/totp/start", (MfaPasswordRequest request, HttpContext context, PasswordHasher hasher, MfaService mfa) =>
        {
            if (Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            var user = ApiAuth.GetUser(context)!;
            if (user.MfaTotpEnabledAt is not null)
            {
                return Results.Json(new ErrorResponse("totp_already_on", "The authenticator app is already set up. Turn it off first to use another one."), statusCode: StatusCodes.Status409Conflict);
            }
            var (secret, uri) = mfa.StartTotp(user);
            return Results.Ok(new MfaTotpSetupDto(secret, uri));
        });

        // Finishes setting up the authenticator app with a code from it; returns recovery codes the first time.
        // <param name="request">The code from the app.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        // <param name="notifier">Tells the account owner about the change.</param>
        group.MapPost("/totp/confirm", (MfaCodeRequest request, HttpContext context, KeePortDb db, MfaService mfa, AuditLog audit, SecurityNotifier notifier) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            if (user.MfaTotpEnabledAt is not null)
            {
                return Results.Json(new ErrorResponse("totp_already_on", "The authenticator app is already set up. Turn it off first to use another one."), statusCode: StatusCodes.Status409Conflict);
            }
            if (mfa.ConfirmTotp(user, request.Code) is not { } codes)
            {
                return Results.Json(new ErrorResponse("wrong_code", "The code is wrong."), statusCode: StatusCodes.Status400BadRequest);
            }
            audit.Record(context, AuditActions.MfaEnabled, targetType: "user", targetId: user.Id, targetName: user.Username, details: "Authenticator app");
            notifier.MfaChanged(user, EmailTemplates.Kinds.MfaEnabled);
            return Results.Ok(new MfaChangeDto(Status(mfa, db.GetUserById(user.Id)!), codes));
        });

        // Turns off the authenticator app; needs the password and a code from the app or a recovery code.
        // <param name="request">The password, the method and the code.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        // <param name="notifier">Tells the account owner about the change.</param>
        group.MapPost("/totp/disable", (MfaDisableRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, MfaService mfa, AuditLog audit, SecurityNotifier notifier) =>
        {
            if (Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            var user = ApiAuth.GetUser(context)!;
            if (user.MfaTotpEnabledAt is null)
            {
                return Results.Ok(new MfaChangeDto(Status(mfa, user), []));
            }
            if (WouldBreakRule(mfa, user, MfaMethods.Totp) is { } ruleError)
            {
                return ruleError;
            }
            var method = request.Method == MfaMethods.Recovery ? MfaMethods.Recovery : MfaMethods.Totp;
            if (mfa.Check(user, method, request.Code) != MfaCheck.Valid)
            {
                return Results.Json(new ErrorResponse("wrong_code", "The code is wrong."), statusCode: StatusCodes.Status400BadRequest);
            }
            mfa.Disable(user, MfaMethods.Totp);
            audit.Record(context, AuditActions.MfaDisabled, targetType: "user", targetId: user.Id, targetName: user.Username, details: "Authenticator app");
            notifier.MfaChanged(user, EmailTemplates.Kinds.MfaDisabled);
            return Results.Ok(new MfaChangeDto(Status(mfa, db.GetUserById(user.Id)!), []));
        });

        // Turns on sign-in codes by e-mail after checking the password; needs a confirmed address and the
        // administrator's permission. Returns recovery codes the first time.
        // <param name="request">The account password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        // <param name="notifier">Tells the account owner about the change.</param>
        group.MapPost("/email/enable", (MfaPasswordRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, MfaService mfa, AuditLog audit, SecurityNotifier notifier) =>
        {
            if (Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            var user = ApiAuth.GetUser(context)!;
            if (!mfa.EmailAllowed(user.Role))
            {
                return Results.Json(new ErrorResponse("email_mfa_not_allowed", "Your administrator does not allow sign-in codes by e-mail."), statusCode: StatusCodes.Status403Forbidden);
            }
            if (user.Email is null || user.EmailVerifiedAt is null)
            {
                return Results.Json(new ErrorResponse("email_not_verified", "Confirm your e-mail address first."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (user.MfaEmailEnabledAt is not null)
            {
                return Results.Ok(new MfaChangeDto(Status(mfa, user), []));
            }
            var codes = mfa.EnableEmail(user);
            audit.Record(context, AuditActions.MfaEnabled, targetType: "user", targetId: user.Id, targetName: user.Username, details: "E-mail codes");
            notifier.MfaChanged(user, EmailTemplates.Kinds.MfaEnabled);
            return Results.Ok(new MfaChangeDto(Status(mfa, db.GetUserById(user.Id)!), codes));
        });

        // Turns off sign-in codes by e-mail after checking the password.
        // <param name="request">The account password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        // <param name="notifier">Tells the account owner about the change.</param>
        group.MapPost("/email/disable", (MfaPasswordRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, MfaService mfa, AuditLog audit, SecurityNotifier notifier) =>
        {
            if (Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            var user = ApiAuth.GetUser(context)!;
            if (user.MfaEmailEnabledAt is null)
            {
                return Results.Ok(new MfaChangeDto(Status(mfa, user), []));
            }
            if (WouldBreakRule(mfa, user, MfaMethods.Email) is { } ruleError)
            {
                return ruleError;
            }
            mfa.Disable(user, MfaMethods.Email);
            audit.Record(context, AuditActions.MfaDisabled, targetType: "user", targetId: user.Id, targetName: user.Username, details: "E-mail codes");
            notifier.MfaChanged(user, EmailTemplates.Kinds.MfaDisabled);
            return Results.Ok(new MfaChangeDto(Status(mfa, db.GetUserById(user.Id)!), []));
        });

        // Creates 10 new recovery codes after checking the password; the old ones stop working.
        // <param name="request">The account password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPost("/recovery-codes", (MfaPasswordRequest request, HttpContext context, PasswordHasher hasher, MfaService mfa, AuditLog audit) =>
        {
            if (Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            var user = ApiAuth.GetUser(context)!;
            if (user.MfaTotpEnabledAt is null && user.MfaEmailEnabledAt is null)
            {
                return Results.Json(new ErrorResponse("mfa_off", "Set up two-factor sign-in first."), statusCode: StatusCodes.Status400BadRequest);
            }
            var codes = mfa.CreateRecoveryCodes(user.Id);
            audit.Record(context, AuditActions.MfaRecoveryCodesCreated, targetType: "user", targetId: user.Id, targetName: user.Username);
            return Results.Ok(new MfaChangeDto(Status(mfa, user), codes));
        });
    }

    /// <summary>Maps the administrator's routes: the two-factor rules and resetting an account's second factors.</summary>
    /// <param name="group">The admin API group.</param>
    private static void MapAdmin(RouteGroupBuilder group)
    {
        // Returns the two-factor rules.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        group.MapGet("/settings/mfa", (HttpContext context, MfaService mfa) =>
            ApiAuth.RequireAdmin(context) ?? Results.Ok(mfa.GetSettings()));

        // Stores the two-factor rules.
        // <param name="request">The new rules.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/settings/mfa", (MfaSettings request, HttpContext context, MfaService mfa, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            mfa.SaveSettings(request);
            audit.Record(context, AuditActions.MfaSettingsChanged, targetType: "settings", targetName: "Two-factor sign-in",
                details: $"Required for admins {OnOff(request.RequireForAdmins)}, users {OnOff(request.RequireForUsers)}; e-mail codes for admins {OnOff(request.EmailForAdmins)}, users {OnOff(request.EmailForUsers)}");
            return Results.Ok(request);
        });

        // Turns off every second factor of an account and signs it out everywhere (except the admin's own session).
        // <param name="id">The account's ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the reset.</param>
        // <param name="notifier">Tells the account owner about the reset.</param>
        group.MapPost("/users/{id}/reset-mfa", (string id, HttpContext context, KeePortDb db, AuditLog audit, SecurityNotifier notifier) =>
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
            db.ResetMfa(target.Id);
            db.DeleteSessionsForUser(target.Id, ApiAuth.GetSession(context)?.Id);
            audit.Record(context, AuditActions.MfaReset, targetType: "user", targetId: target.Id, targetName: target.Username, details: "Signed out everywhere");
            if (!string.Equals(target.Id, ApiAuth.GetUser(context)?.Id, StringComparison.Ordinal))
            {
                notifier.MfaChanged(target, EmailTemplates.Kinds.MfaReset);
            }
            return Results.NoContent();
        });
    }

    /// <summary>
    /// Blocks every API request of an account that must set up a second factor first, except what the setup needs:
    /// account details, CSRF token, sign-out, language, e-mail confirmation and the two-factor routes.
    /// </summary>
    /// <param name="app">The application pipeline.</param>
    public static IApplicationBuilder UseKeePortMfaSetup(this IApplicationBuilder app)
    {
        // Answers 403 mfa_setup_required for requests the account may not make yet.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="next">The next middleware in the request pipeline.</param>
        return app.Use(async (context, next) =>
        {
            if (ApiAuth.GetUser(context) is { } user && !AllowedDuringSetup(context.Request.Path.Value ?? string.Empty) &&
                context.RequestServices.GetRequiredService<MfaService>().SetupRequired(user))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new ErrorResponse("mfa_setup_required", "Set up two-factor sign-in first."));
                return;
            }
            await next();
        });
    }

    /// <summary>Whether a path stays usable while the account has to set up a second factor.</summary>
    /// <param name="path">The request path.</param>
    private static bool AllowedDuringSetup(string path)
    {
        string? rest = null;
        foreach (var prefix in new[] { SessionService.AdminApiPath + "/auth/", "/api/auth/" })
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                rest = path[prefix.Length..].ToLowerInvariant();
                break;
            }
        }
        return rest is not null && (rest is "me" or "csrf" or "logout" or "language" or "email" or "email/verification" or "email/verify"
            || rest == "mfa" || rest.StartsWith("mfa/", StringComparison.Ordinal));
    }

    /// <summary>Checks that a user is signed in and entered the correct account password.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="hasher">The service for verifying passwords.</param>
    /// <param name="password">The entered password.</param>
    /// <returns>An error result, or null when everything is fine.</returns>
    private static IResult? Authorize(HttpContext context, PasswordHasher hasher, string? password)
    {
        if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
        {
            return unauthorized;
        }
        var user = ApiAuth.GetUser(context)!;
        return string.IsNullOrEmpty(password) || !hasher.Verify(password, user.PasswordHash)
            ? Results.Json(new ErrorResponse("invalid_password", "Current password is incorrect."), statusCode: StatusCodes.Status403Forbidden)
            : null;
    }

    /// <summary>Refuses to turn off the last second factor while the administrator requires one.</summary>
    /// <param name="mfa">Two-factor sign-in.</param>
    /// <param name="user">The account.</param>
    /// <param name="method">The method that would be turned off.</param>
    private static IResult? WouldBreakRule(MfaService mfa, UserRecord user, string method)
    {
        var remaining = mfa.Methods(user).Where(/* Other methods. */ m => m != method);
        return mfa.Required(user.Role) && !remaining.Any()
            ? Results.Json(new ErrorResponse("mfa_required", "Your administrator requires two-factor sign-in. Set up another method before you turn this one off."), statusCode: StatusCodes.Status409Conflict)
            : null;
    }

    /// <summary>Describes the two-factor state of an account for its profile.</summary>
    /// <param name="mfa">Two-factor sign-in.</param>
    /// <param name="user">The account.</param>
    private static MfaStatusDto Status(MfaService mfa, UserRecord user)
    {
        var settings = mfa.GetSettings();
        return new MfaStatusDto(user.MfaTotpEnabledAt, user.MfaEmailEnabledAt, mfa.EmailAllowed(user.Role, settings), user.EmailVerifiedAt is not null,
            mfa.RecoveryCodesLeft(user.Id), mfa.Required(user.Role, settings), mfa.IsActive(user, settings));
    }

    /// <summary>The answer for an unknown, expired or used-up pending sign-in.</summary>
    private static IResult Expired()
        => Results.Json(new ErrorResponse("mfa_expired", "The sign-in has expired. Sign in again."), statusCode: StatusCodes.Status401Unauthorized);

    /// <summary>Writes on or off for the audit log.</summary>
    /// <param name="value">The switch.</param>
    private static string OnOff(bool value) => value ? "on" : "off";
}
