using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

/// <summary>
/// E-mail endpoints: SMTP settings and test mail (admin), confirming the own address and choosing notifications (both
/// account types), invitations (admin), and the public password reset and set-password flow of the web vault.
/// </summary>
public static class EmailEndpoints
{
    /// <summary>The fewest seconds between two verification codes for one account.</summary>
    private const int CodeIntervalSeconds = 60;

    /// <summary>The most entries the e-mail log returns.</summary>
    private const int EmailLogLimit = 1000;

    /// <summary>Registers all e-mail routes.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapEmailEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup(SessionService.AdminApiPath);
        MapAdmin(admin);
        MapAccount(app.MapGroup(SessionService.AdminApiPath + "/auth"));
        MapAccount(app.MapGroup("/api/auth"));
        MapPublic(app.MapGroup("/api/auth"));
    }

    /// <summary>Maps the admin routes: e-mail settings, test mail and invitations.</summary>
    /// <param name="group">The admin API group.</param>
    private static void MapAdmin(RouteGroupBuilder group)
    {
        // Returns the SMTP settings (without the password) and the queue state.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="settings">The SMTP settings.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/settings/email", (HttpContext context, EmailSettingsService settings, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var current = settings.Get();
            return Results.Ok(new EmailStatusDto(EmailSettingsService.ToDto(current), current.Configured, db.GetEmailQueueStatus()));
        });

        // Stores new SMTP settings; a missing password keeps the stored one, an empty one removes it.
        // <param name="request">The new settings.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="settings">The SMTP settings.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/settings/email", (EmailSettingsDto request, HttpContext context, EmailSettingsService settings, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (settings.Save(request) is { } error)
            {
                return Results.Json(new ErrorResponse("invalid_email_settings", error), statusCode: StatusCodes.Status400BadRequest);
            }
            var current = settings.Get();
            audit.Record(context, AuditActions.EmailSettingsChanged, targetType: "settings", targetName: "E-mail",
                details: $"{current.Host ?? "no server"}:{current.Port} {current.Security}, from {current.FromAddress ?? "-"}");
            return Results.Ok(new EmailStatusDto(EmailSettingsService.ToDto(current), current.Configured, db.GetEmailQueueStatus()));
        });

        // Sends a test e-mail to the signed-in administrator right away and reports the server's answer.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="settings">The SMTP settings.</param>
        // <param name="db">The SQLite store, whose e-mail log records the test.</param>
        // <param name="audit">The audit log that records the attempt.</param>
        // <param name="cancellationToken">A token that cancels the operation.</param>
        group.MapPost("/settings/email/test", async (HttpContext context, EmailSettingsService settings, KeePortDb db, AuditLog audit, CancellationToken cancellationToken) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var user = ApiAuth.GetUser(context)!;
            var current = settings.Get();
            if (string.IsNullOrWhiteSpace(current.Host) || string.IsNullOrWhiteSpace(current.FromAddress))
            {
                return Results.Json(new ErrorResponse("email_not_configured", "Enter and save the SMTP server and sender address first."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (user.Email is null)
            {
                return Results.Json(new ErrorResponse("no_email", "Add an e-mail address to your profile first."), statusCode: StatusCodes.Status400BadRequest);
            }
            var email = EmailTemplates.Render(EmailTemplates.Kinds.Test, user.Language, current.PublicUrl ?? "KeePort", new Dictionary<string, string>());
            try
            {
                await SmtpMailer.SendAsync(current, settings.RevealPassword(current), user.Email, email.Subject, email.Text, email.Html, cancellationToken);
                db.LogDirectEmail(EmailTemplates.Kinds.Test, user.Email, email.Subject, null);
                audit.Record(context, AuditActions.TestEmailSent, targetType: "settings", targetName: "E-mail", details: user.Email);
                return Results.Ok(new { sentTo = user.Email });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                db.LogDirectEmail(EmailTemplates.Kinds.Test, user.Email, email.Subject, SmtpMailer.Describe(ex));
                audit.Record(context, AuditActions.TestEmailSent, success: false, targetType: "settings", targetName: "E-mail", details: SmtpMailer.Describe(ex));
                return Results.Json(new ErrorResponse("email_failed", SmtpMailer.Describe(ex)), statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Lists the e-mail log, newest first: what was sent to whom and when, and why sending failed. No content is kept.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/logs/email", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(db.ListEmailLog(EmailLogLimit));
        });

        // Sends (again) an invitation link to a user account, e.g. when the first one expired.
        // <param name="id">The user's ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="tokens">The one-time tokens.</param>
        // <param name="queue">The e-mail queue.</param>
        // <param name="audit">The audit log that records the invitation.</param>
        group.MapPost("/users/{id}/invite", (string id, HttpContext context, KeePortDb db, AccountTokens tokens, EmailQueue queue, AuditLog audit) =>
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
            return SendInvitation(context, target, tokens, queue, audit) ?? Results.NoContent();
        });
    }

    /// <summary>Whether setting a password with this link also needs a code from the authenticator app.</summary>
    /// <param name="record">The link's token.</param>
    /// <param name="user">The account.</param>
    private static bool ResetNeedsCode(AccountTokenRecord record, UserRecord user) => record.Purpose == "reset" && user.MfaTotpEnabledAt is not null;

    /// <summary>
    /// Sends an invitation link to a user account. Returns an error result when the account or the e-mail setup does
    /// not allow it, otherwise null.
    /// </summary>
    /// <param name="context">The admin's request.</param>
    /// <param name="target">The invited account.</param>
    /// <param name="tokens">The one-time tokens.</param>
    /// <param name="queue">The e-mail queue.</param>
    /// <param name="audit">The audit log.</param>
    internal static IResult? SendInvitation(HttpContext context, UserRecord target, AccountTokens tokens, EmailQueue queue, AuditLog audit)
    {
        if (target.Role != UserRole.User || target.Disabled || target.Email is null)
        {
            return Results.Json(new ErrorResponse("invite_not_possible", "Invitations are only for active user accounts with an e-mail address."), statusCode: StatusCodes.Status400BadRequest);
        }
        if (!queue.IsConfigured)
        {
            return Results.Json(new ErrorResponse("email_not_configured", "Set up e-mail under Settings first."), statusCode: StatusCodes.Status400BadRequest);
        }
        var site = context.RequestServices.GetRequiredService<EmailSettingsService>().Get().PublicUrl!;
        var token = tokens.CreateLink(target.Id, "invite", target.Email, AccountTokens.InviteLifetime);
        queue.Enqueue(EmailTemplates.Kinds.Invite, target.Email, target.Language, new Dictionary<string, string>
        {
            ["username"] = target.Username,
            ["inviter"] = ApiAuth.GetUser(context)?.Username ?? "An administrator",
            ["site"] = site,
            ["url"] = $"{site}/#token={token}"
        });
        audit.Record(context, AuditActions.InvitationSent, targetType: "user", targetId: target.Id, targetName: target.Username, details: target.Email);
        return null;
    }

    /// <summary>Maps the routes for the signed-in account: confirming the address and choosing notifications.</summary>
    /// <param name="group">The auth group of the admin console or the web vault.</param>
    private static void MapAccount(RouteGroupBuilder group)
    {
        // Sends a 6-digit code to the account's current address; at most one per minute and five per hour.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="tokens">The one-time codes.</param>
        // <param name="queue">The e-mail queue.</param>
        group.MapPost("/email/verification", (HttpContext context, KeePortDb db, AccountTokens tokens, EmailQueue queue) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            if (user.Email is null)
            {
                return Results.Json(new ErrorResponse("no_email", "Add an e-mail address to your profile first."), statusCode: StatusCodes.Status400BadRequest);
            }
            if (!queue.IsConfigured)
            {
                return Results.Json(new ErrorResponse("email_not_configured", "E-mail is not set up on this server yet. Ask your administrator."), statusCode: StatusCodes.Status400BadRequest);
            }
            var now = DateTimeOffset.UtcNow;
            if (db.CountAccountTokens(user.Id, "verify", now.AddSeconds(-CodeIntervalSeconds)) > 0 || db.CountAccountTokens(user.Id, "verify", now.AddHours(-1)) >= 5)
            {
                return Results.Json(new ErrorResponse("too_many_codes", "Wait a minute before asking for a new code."), statusCode: StatusCodes.Status429TooManyRequests);
            }
            var code = tokens.CreateCode(user.Id, user.Email);
            queue.Enqueue(EmailTemplates.Kinds.Verify, user.Email, user.Language, new Dictionary<string, string> { ["username"] = user.Username, ["code"] = code });
            return Results.NoContent();
        });

        // Confirms the account's address with the code from the e-mail.
        // <param name="request">The code.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="tokens">The one-time codes.</param>
        // <param name="audit">The audit log that records the confirmation.</param>
        group.MapPost("/email/verify", (VerifyEmailRequest request, HttpContext context, KeePortDb db, AccountTokens tokens, AuditLog audit) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var result = tokens.CheckCode(user.Id, request.Code, out var email);
            if (result == CodeCheck.Valid && string.Equals(email, user.Email, StringComparison.OrdinalIgnoreCase))
            {
                db.SetEmailVerified(user.Id, DateTimeOffset.UtcNow);
                audit.Record(context, AuditActions.EmailVerified, targetType: "user", targetId: user.Id, targetName: user.Username, details: user.Email);
                return Results.Ok(AuthEndpoints.ToDto(db.GetUserById(user.Id)!));
            }
            return result switch
            {
                CodeCheck.Wrong => Results.Json(new ErrorResponse("wrong_code", "The code is wrong."), statusCode: StatusCodes.Status400BadRequest),
                CodeCheck.TooManyAttempts => Results.Json(new ErrorResponse("too_many_attempts", "Too many wrong codes. Ask for a new one."), statusCode: StatusCodes.Status400BadRequest),
                _ => Results.Json(new ErrorResponse("code_expired", "The code has expired. Ask for a new one."), statusCode: StatusCodes.Status400BadRequest)
            };
        });

        // Chooses which security notifications the account gets by e-mail.
        // <param name="request">The choices.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/notifications", (EmailNotificationsRequest request, HttpContext context, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            db.SetEmailNotifications(user.Id, request.SignIn, request.AppPassword);
            if (request.SignIn != user.NotifySignIn || request.AppPassword != user.NotifyAppPassword)
            {
                audit.Record(context, AuditActions.SettingsChanged, targetType: "user", targetId: user.Id, targetName: user.Username,
                    details: $"E-mail notifications: sign-ins {(request.SignIn ? "on" : "off")}, app passwords {(request.AppPassword ? "on" : "off")}");
            }
            return Results.Ok(AuthEndpoints.ToDto(db.GetUserById(user.Id)!));
        });
    }

    /// <summary>Maps the public routes of the web vault: forgotten password and setting a password with a link.</summary>
    /// <param name="group">The web vault's auth group.</param>
    private static void MapPublic(RouteGroupBuilder group)
    {
        // Sends a reset link to a user account found by username or address. The answer is always the same, so nobody
        // can find out which accounts exist. Administrator accounts cannot be reset by e-mail.
        // <param name="request">The username or address.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="tokens">The one-time tokens.</param>
        // <param name="queue">The e-mail queue.</param>
        // <param name="settings">The SMTP settings, for the web vault address.</param>
        // <param name="audit">The audit log that records the request.</param>
        group.MapPost("/password-reset", (PasswordResetRequest request, HttpContext context, KeePortDb db, AccountTokens tokens, EmailQueue queue, EmailSettingsService settings, AuditLog audit) =>
        {
            var identifier = request.Identifier?.Trim() ?? string.Empty;
            var user = identifier.Length is 0 or > 254 ? null
                : db.GetUserByUsername(identifier) ?? db.ListUsers().FirstOrDefault(/* Same address. */ u => string.Equals(u.Email, identifier, StringComparison.OrdinalIgnoreCase));
            var reason = user is null ? "No matching account"
                : user.Role != UserRole.User ? "Administrator accounts cannot be reset by e-mail"
                : user.Disabled ? "Account disabled"
                : user.EmailVerifiedAt is null || user.Email is null ? "E-mail address not confirmed"
                : !queue.IsConfigured ? "E-mail not set up"
                : db.CountAccountTokens(user.Id, "reset", DateTimeOffset.UtcNow.AddHours(-1)) >= 3 ? "Too many requests in the last hour"
                : null;
            if (reason is null)
            {
                var site = settings.Get().PublicUrl!;
                var token = tokens.CreateLink(user!.Id, "reset", user.Email, AccountTokens.ResetLifetime);
                queue.Enqueue(EmailTemplates.Kinds.Reset, user.Email!, user.Language, new Dictionary<string, string>
                {
                    ["username"] = user.Username,
                    ["url"] = $"{site}/#token={token}"
                });
            }
            audit.Record(context, AuditActions.PasswordResetRequested, success: reason is null, actor: user, actorName: identifier,
                targetType: "user", targetId: user?.Id, targetName: user?.Username, details: reason ?? $"Link sent to {user!.Email}");
            return Results.NoContent();
        }).RequireRateLimiting(AuthEndpoints.CredentialRateLimitPolicy);

        // Tells the web vault what a link is for (invitation or reset), for which account, and whether a code from the
        // authenticator app is needed too, before the password form.
        // Not rate-limited like sign-ins: the token has 256 random bits, so guessing is hopeless.
        // <param name="request">The token from the link.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="tokens">The one-time tokens.</param>
        group.MapPost("/token", (AccountTokenRequest request, KeePortDb db, AccountTokens tokens) =>
        {
            var record = tokens.FindLink(request.Token, "invite") ?? tokens.FindLink(request.Token, "reset");
            var user = record is null ? null : db.GetUserById(record.UserId);
            return record is null || user is null || user.Disabled
                ? Results.NotFound(new ErrorResponse("invalid_link", "This link is invalid or has expired."))
                : Results.Ok(new AccountTokenInfoDto(record.Purpose, user.Username, ResetNeedsCode(record, user)));
        });

        // Sets the account password with a link from an invitation or reset e-mail. A reset signs the account out
        // everywhere; both confirm the e-mail address, because the link arrived there. When the account uses an
        // authenticator app, a reset also needs a code from it or a recovery code; e-mail codes would add nothing,
        // because the link already proves access to the mailbox.
        // <param name="request">The token and the new password.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="hasher">The service for hashing passwords.</param>
        // <param name="tokens">The one-time tokens.</param>
        // <param name="notifier">Sends the "password changed" notification.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPost("/set-password", (SetPasswordRequest request, HttpContext context, KeePortDb db, PasswordHasher hasher, AccountTokens tokens, SecurityNotifier notifier, AuditLog audit) =>
        {
            var record = tokens.FindLink(request.Token, "invite") ?? tokens.FindLink(request.Token, "reset");
            var user = record is null ? null : db.GetUserById(record.UserId);
            if (record is null || user is null || user.Disabled)
            {
                return Results.NotFound(new ErrorResponse("invalid_link", "This link is invalid or has expired."));
            }
            if (PasswordPolicy.Validate(request.Password, user.Username) is { } passwordError)
            {
                return Results.Json(new ErrorResponse("invalid_password", passwordError), statusCode: StatusCodes.Status400BadRequest);
            }
            if (ResetNeedsCode(record, user))
            {
                var mfa = context.RequestServices.GetRequiredService<MfaService>();
                var method = request.Method == MfaMethods.Recovery ? MfaMethods.Recovery : MfaMethods.Totp;
                if (mfa.Check(user, method, request.Code) != MfaCheck.Valid)
                {
                    // Wrong codes use up the link, so it cannot be used to guess codes.
                    db.CountAccountTokenAttempt(record.TokenHash);
                    if (record.Attempts + 1 >= 5)
                    {
                        tokens.Use(record);
                    }
                    audit.Record(context, AuditActions.PasswordResetCompleted, success: false, actor: user, targetType: "user", targetId: user.Id,
                        targetName: user.Username, details: "Wrong two-factor code");
                    return Results.Json(new ErrorResponse("wrong_code", "The code is wrong."), statusCode: StatusCodes.Status400BadRequest);
                }
            }
            tokens.Use(record);
            db.UpdateUserPassword(user.Id, hasher.Hash(request.Password!));
            db.DeleteSessionsForUser(user.Id);
            if (string.Equals(record.Email, user.Email, StringComparison.OrdinalIgnoreCase))
            {
                db.SetEmailVerified(user.Id, user.EmailVerifiedAt ?? DateTimeOffset.UtcNow);
            }
            var invite = record.Purpose == "invite";
            audit.Record(context, invite ? AuditActions.InvitationAccepted : AuditActions.PasswordResetCompleted, actor: user,
                targetType: "user", targetId: user.Id, targetName: user.Username);
            if (!invite)
            {
                notifier.PasswordChanged(db.GetUserById(user.Id)!, EmailTemplates.Kinds.PasswordChangedReset);
            }
            return Results.NoContent();
        });
    }
}
