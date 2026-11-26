using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

/// <summary>
/// Passkeys: adding and removing them in the profile, signing in with one without username and password, and using one
/// as second factor after the password. Works the same for the admin console and the web vault.
/// </summary>
public static class PasskeyEndpoints
{
    /// <summary>Registers the passkey routes for both areas.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapPasskeyEndpoints(this IEndpointRouteBuilder app)
    {
        Map(app.MapGroup(SessionService.AdminApiPath + "/auth"), UserRole.Admin);
        Map(app.MapGroup("/api/auth"), UserRole.User);
    }

    /// <summary>Maps the routes of one area.</summary>
    /// <param name="group">The auth group of the admin console or the web vault.</param>
    /// <param name="role">The role handled by this group.</param>
    private static void Map(RouteGroupBuilder group, UserRole role)
    {
        // Starts adding a passkey after checking the account password.
        // <param name="request">The account password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="passkeys">The passkey service.</param>
        group.MapPost("/mfa/passkeys/options", (MfaPasswordRequest request, HttpContext context, PasswordHasher hasher, PasskeyService passkeys) =>
        {
            if (MfaEndpoints.Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            return Run(() => Results.Ok(passkeys.StartRegistration(ApiAuth.GetUser(context)!, context)));
        });

        // Stores a new passkey from the browser's answer; returns recovery codes when it is the first second factor.
        // <param name="request">The ceremony ID, the name and the browser's answer.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="passkeys">The passkey service.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        // <param name="notifier">Tells the account owner about the change.</param>
        // <param name="cancellationToken">A token that cancels the operation.</param>
        group.MapPost("/mfa/passkeys", async (PasskeyRegisterRequest request, HttpContext context, KeePortDb db, PasskeyService passkeys, MfaService mfa, AuditLog audit, SecurityNotifier notifier, CancellationToken cancellationToken) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var before = db.CountPasskeys(user.Id);
            try
            {
                var passkey = await passkeys.FinishRegistrationAsync(user, request.ChallengeId, request.Response, request.Name, context, cancellationToken);
                var codes = mfa.PasskeyAdded(user, before);
                audit.Record(context, AuditActions.PasskeyAdded, targetType: "user", targetId: user.Id, targetName: user.Username, details: $"{passkey.Name} ({passkey.RpId})");
                notifier.MfaChanged(user, EmailTemplates.Kinds.MfaEnabled);
                return Results.Ok(new MfaChangeDto(MfaEndpoints.Status(mfa, db.GetUserById(user.Id)!), codes));
            }
            catch (PasskeyException ex)
            {
                return Failed(ex);
            }
        });

        // Removes one passkey after checking the account password.
        // <param name="id">KeePort's ID of the passkey.</param>
        // <param name="request">The account password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for verifying passwords.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="audit">The audit log that records the change.</param>
        // <param name="notifier">Tells the account owner about the change.</param>
        group.MapPost("/mfa/passkeys/{id}/delete", (string id, MfaPasswordRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, MfaService mfa, AuditLog audit, SecurityNotifier notifier) =>
        {
            if (MfaEndpoints.Authorize(context, hasher, request.Password) is { } error)
            {
                return error;
            }
            var user = ApiAuth.GetUser(context)!;
            var passkey = db.ListPasskeys(user.Id).FirstOrDefault(/* The one to remove. */ p => p.Id == id);
            if (passkey is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Passkey not found."));
            }
            if (db.CountPasskeys(user.Id) == 1 && MfaEndpoints.WouldBreakRule(mfa, user, MfaMethods.Passkey) is { } ruleError)
            {
                return ruleError;
            }
            db.DeletePasskey(user.Id, id);
            mfa.RemoveCodesIfNoFactorLeft(user.Id);
            audit.Record(context, AuditActions.PasskeyRemoved, targetType: "user", targetId: user.Id, targetName: user.Username, details: $"{passkey.Name} ({passkey.RpId})");
            notifier.MfaChanged(user, EmailTemplates.Kinds.MfaDisabled);
            return Results.Ok(new MfaChangeDto(MfaEndpoints.Status(mfa, db.GetUserById(user.Id)!), []));
        });

        // Starts a sign-in with a passkey without username and password.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="passkeys">The passkey service.</param>
        group.MapPost("/login/passkey/options", (HttpContext context, PasskeyService passkeys) =>
            Run(() => Results.Ok(passkeys.StartLogin(role, null, context))))
            .RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);

        // Signs in with a passkey without username and password; the passkey proves both factors.
        // <param name="request">The ceremony ID and the browser's answer.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="passkeys">The passkey service.</param>
        // <param name="audit">The audit log that records the attempt.</param>
        // <param name="cancellationToken">A token that cancels the operation.</param>
        group.MapPost("/login/passkey", async (PasskeyLoginRequest request, HttpContext context, KeePortDb db, PasskeyService passkeys, AuditLog audit, CancellationToken cancellationToken) =>
        {
            try
            {
                var (user, passkey) = await passkeys.FinishLoginAsync(request.ChallengeId, request.Response, role, null, context, cancellationToken);
                return AuthEndpoints.CompleteSignIn(context, user, role, $"Passkey: {passkey.Name}");
            }
            catch (PasskeyException ex)
            {
                AuthEndpoints.RecordFailedLogin(context, db, audit, role, null, null, "Passkey not accepted");
                return Failed(ex);
            }
        }).RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);

        // Starts the passkey check as second factor of a pending sign-in.
        // <param name="request">The pending sign-in token.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="passkeys">The passkey service.</param>
        group.MapPost("/login/mfa/passkey/options", (MfaEmailCodeRequest request, HttpContext context, KeePortDb db, MfaService mfa, PasskeyService passkeys) =>
        {
            var pending = mfa.FindPending(request.MfaToken, role);
            var user = pending is null ? null : db.GetUserById(pending.UserId);
            if (pending is null || user is null || user.Disabled)
            {
                return MfaEndpoints.Expired();
            }
            return Run(() => Results.Ok(passkeys.StartLogin(role, user, context)));
        }).RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);

        // Checks the passkey as second factor of a pending sign-in and, when it is correct, issues the session cookie.
        // <param name="request">The pending sign-in token, the ceremony ID and the browser's answer.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="mfa">Two-factor sign-in.</param>
        // <param name="passkeys">The passkey service.</param>
        // <param name="audit">The audit log that records the attempt.</param>
        // <param name="cancellationToken">A token that cancels the operation.</param>
        group.MapPost("/login/mfa/passkey", async (PasskeyLoginRequest request, HttpContext context, KeePortDb db, MfaService mfa, PasskeyService passkeys, AuditLog audit, CancellationToken cancellationToken) =>
        {
            var pending = mfa.FindPending(request.MfaToken, role);
            var pendingUser = pending is null ? null : db.GetUserById(pending.UserId);
            if (pending is null || pendingUser is null || pendingUser.Disabled)
            {
                return MfaEndpoints.Expired();
            }
            try
            {
                var (user, passkey) = await passkeys.FinishLoginAsync(request.ChallengeId, request.Response, role, pendingUser.Id, context, cancellationToken);
                mfa.Complete(pending);
                return AuthEndpoints.CompleteSignIn(context, user, role, $"Second factor: passkey {passkey.Name}");
            }
            catch (PasskeyException ex)
            {
                mfa.CountFailure(pending);
                AuthEndpoints.RecordFailedLogin(context, db, audit, role, pendingUser, pendingUser.Username, "Passkey not accepted");
                return Failed(ex);
            }
        }).RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);
    }

    /// <summary>Runs a step that may fail because the page has no domain name, and turns that into a 400 answer.</summary>
    /// <param name="action">The step.</param>
    private static IResult Run(Func<IResult> action)
    {
        try
        {
            return action();
        }
        catch (PasskeyException ex)
        {
            return Failed(ex);
        }
    }

    /// <summary>The answer for a passkey that cannot be used.</summary>
    /// <param name="ex">Why.</param>
    private static IResult Failed(PasskeyException ex)
        => Results.Json(new ErrorResponse("passkey_failed", ex.Message), statusCode: StatusCodes.Status400BadRequest);
}
