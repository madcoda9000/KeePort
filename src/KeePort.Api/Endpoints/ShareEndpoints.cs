using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

/// <summary>
/// Sharing secrets with people without a KeePort account. The web vault encrypts in the browser and sends only
/// ciphertext; the recipient page decrypts in the recipient's browser. Owners manage their shares, administrators set
/// the rules and can revoke any share, and the public routes let a recipient read the encrypted secret.
/// </summary>
public static class ShareEndpoints
{
    /// <summary>The rate-limit policy of the public recipient routes.</summary>
    public const string PublicRateLimitPolicy = "share-public";

    /// <summary>The path of the public recipient routes; they work without a session or CSRF token.</summary>
    public const string PublicApiPath = "/api/share";

    /// <summary>The name recorded in the audit log for the person who opens a share; they have no account.</summary>
    private const string RecipientName = "(recipient)";

    /// <summary>The fewest seconds between two e-mail codes for one share.</summary>
    private const int CodeIntervalSeconds = 60;

    /// <summary>How long an e-mail code works.</summary>
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);

    /// <summary>The answer for every share that does not exist or cannot be opened any more, without details.</summary>
    private static IResult Unavailable() => Results.Json(new ErrorResponse("share_unavailable", "This secret is no longer available."), statusCode: StatusCodes.Status404NotFound);

    /// <summary>Registers the owner, admin and public share routes.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapShareEndpoints(this IEndpointRouteBuilder app)
    {
        MapOwner(app.MapGroup("/api/shares"));
        MapAdmin(app.MapGroup(SessionService.AdminApiPath + "/sharing"));
        MapPublic(app.MapGroup(PublicApiPath));
    }

    /// <summary>Maps the routes of the web vault user who shares.</summary>
    /// <param name="group">The /api/shares group.</param>
    private static void MapOwner(RouteGroupBuilder group)
    {
        // Returns what the signed-in user may do when sharing.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="vault">The vault service, for the user's vaults.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/policy", (HttpContext context, ShareService shares, VaultService vault, EmailQueue email, KeePortDb db) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var settings = shares.GetSettings();
            var blocked = db.ListShareVaultBlocks();
            var blockedForUser = vault.ListForUser(user).Select(/* Vault ID. */ file => file.Id).Where(blocked.Contains).ToList();
            return Results.Ok(new SharePolicyDto(shares.MayShare(user), settings.MaxDays, settings.MaxViews, settings.RequirePassword,
                settings.AllowEmail && email.IsConfigured, settings.AllowEmailCode && email.IsConfigured, blockedForUser));
        });

        // Lists the signed-in user's shares, newest first.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("", (HttpContext context, KeePortDb db) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var now = DateTimeOffset.UtcNow;
            return Results.Ok(db.ListShares(user.Id).Select(/* Share. */ share => ToDto(share, now)));
        });

        // Creates a share from encrypted data; checks the rules, the vault permission and the limits on the server.
        // <param name="request">The encrypted secret and its settings.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="vault">The vault service, for the permission check.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the share.</param>
        group.MapPost("", (CreateShareRequest request, HttpContext context, ShareService shares, VaultService vault, EmailQueue email, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            if (!shares.MayShare(user))
            {
                return Forbidden("sharing_not_allowed", "Sharing is not allowed for your account.");
            }
            var file = vault.Get(request.VaultFileId ?? string.Empty);
            if (file is null || !vault.CanRead(user, file))
            {
                return Results.Json(new ErrorResponse("not_found", "Vault not found."), statusCode: StatusCodes.Status404NotFound);
            }
            if (!vault.CanWrite(user, file))
            {
                return Forbidden("sharing_needs_write", "You need read-write access to share entries of this vault.");
            }
            if (!shares.VaultAllowsSharing(file.Id))
            {
                return Forbidden("sharing_vault_blocked", "Entries of this vault may not be shared.");
            }
            var settings = shares.GetSettings();
            var label = (request.Label ?? string.Empty).Trim();
            if (label.Length is 0 or > ShareService.MaxLabelLength || label.Any(char.IsControl))
            {
                return BadRequest("The label must be 1 to 100 characters.");
            }
            if (string.IsNullOrWhiteSpace(request.EntryUuid) || request.EntryUuid.Length > 64)
            {
                return BadRequest("The entry is missing.");
            }
            if (request.MaxViews < 1 || request.MaxViews > settings.MaxViews || request.ExpiresInHours < 1 || request.ExpiresInHours > settings.MaxDays * 24)
            {
                return BadRequest("The number of views or the validity is above the limit your administrator set.");
            }
            if (ShareService.CheckCrypto(request.Ciphertext, request.Iv, request.KdfSalt, request.KdfParams) is { } cryptoError)
            {
                return BadRequest(cryptoError);
            }
            var proofHash = ShareService.HashProof(request.Proof);
            if (proofHash is null)
            {
                return BadRequest("The access proof is malformed.");
            }
            var hasPassword = request.KdfParams is not null;
            if (settings.RequirePassword && !hasPassword)
            {
                return BadRequest("Your administrator requires a password for the recipient.");
            }
            string? recipient = null;
            if (!string.IsNullOrWhiteSpace(request.RecipientEmail))
            {
                recipient = EmailAddress.Normalize(request.RecipientEmail);
                if (recipient is null)
                {
                    return BadRequest("Enter a valid e-mail address for the recipient.");
                }
            }
            if (request.RequireEmailCode && (!settings.AllowEmailCode || !email.IsConfigured))
            {
                return BadRequest("Confirming the recipient's address is not available.");
            }
            if (request.RequireEmailCode && recipient is null)
            {
                return BadRequest("Enter a valid e-mail address for the recipient.");
            }
            var id = ShareService.NewId();
            var expires = DateTimeOffset.UtcNow.AddHours(request.ExpiresInHours);
            db.CreateShare(new NewShare(id, user.Id, file.Id, request.EntryUuid, label, request.Ciphertext, request.Iv, request.KdfSalt,
                request.KdfParams, proofHash, recipient, request.RequireEmailCode, request.MaxViews, expires));
            audit.Record(context, AuditActions.ShareCreated, targetType: "share", targetId: id, targetName: label,
                details: $"Vault {file.Name}, {request.MaxViews} view(s), {request.ExpiresInHours} h, password {(hasPassword ? "yes" : "no")}, e-mail code {(request.RequireEmailCode ? "yes" : "no")}");
            return Results.Ok(ToDto(db.GetShare(id)!, DateTimeOffset.UtcNow));
        });

        // E-mails the link to the recipient (way B). Only allowed with a recipient password, so the link alone is useless
        // to the server and the mail provider; the e-mail body is removed from the database once it is sent.
        // <param name="id">The share's ID.</param>
        // <param name="request">The link key; KeePort builds the link with the web vault address.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue.</param>
        // <param name="emailSettings">The e-mail settings, for the web vault address.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the e-mail.</param>
        group.MapPost("/{id}/send", (string id, SendShareRequest request, HttpContext context, ShareService shares, EmailQueue email, EmailSettingsService emailSettings, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var share = db.GetShare(id);
            if (share is null || share.OwnerUserId != user.Id || !share.IsActive(DateTimeOffset.UtcNow))
            {
                return Results.Json(new ErrorResponse("not_found", "Share not found."), statusCode: StatusCodes.Status404NotFound);
            }
            if (!shares.GetSettings().AllowEmail || !email.IsConfigured)
            {
                return BadRequest("Sending by e-mail is not available.");
            }
            if (share.KdfParams is null)
            {
                return BadRequest("Sending by e-mail needs a password for the recipient.");
            }
            if (share.RecipientEmail is null)
            {
                return BadRequest("Enter a valid e-mail address for the recipient.");
            }
            if (ShareService.HashProof(request.Key) is null)
            {
                return BadRequest("The link key is malformed.");
            }
            var link = $"{emailSettings.Get().PublicUrl}/s/{share.Id}#{request.Key}";
            var language = user.Language;
            var sent = email.Enqueue(EmailTemplates.Kinds.ShareLink, share.RecipientEmail, language, new Dictionary<string, string>
            {
                ["sender"] = user.Username,
                ["url"] = link,
                ["expires"] = EmailTemplates.FormatTime(share.ExpiresAt),
                ["views"] = share.MaxViews.ToString(System.Globalization.CultureInfo.InvariantCulture)
            });
            if (!sent)
            {
                return BadRequest("Sending by e-mail is not available.");
            }
            db.MarkShareSentByEmail(share.Id);
            audit.Record(context, AuditActions.ShareSent, targetType: "share", targetId: share.Id, targetName: share.Label, details: $"To {share.RecipientEmail}");
            return Results.Ok(ToDto(db.GetShare(share.Id)!, DateTimeOffset.UtcNow));
        });

        // Revokes one of the signed-in user's shares; the ciphertext is deleted at once.
        // <param name="id">The share's ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the revocation.</param>
        group.MapDelete("/{id}", (string id, HttpContext context, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var share = db.GetShare(id);
            if (share is null || share.OwnerUserId != user.Id)
            {
                return Results.Json(new ErrorResponse("not_found", "Share not found."), statusCode: StatusCodes.Status404NotFound);
            }
            if (db.RevokeShare(id))
            {
                audit.Record(context, AuditActions.ShareRevoked, targetType: "share", targetId: id, targetName: share.Label);
            }
            return Results.NoContent();
        });
    }

    /// <summary>Maps the admin routes: rules, per-user and per-vault switches, and the list of all shares.</summary>
    /// <param name="group">The admin sharing group.</param>
    private static void MapAdmin(RouteGroupBuilder group)
    {
        // Returns the sharing rules, the users and vaults with their switches, and all shares.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="vault">The vault service, for the vault list.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("", (HttpContext context, ShareService shares, EmailQueue email, VaultService vault, KeePortDb db) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            return Results.Ok(BuildAdminView(shares, email, vault, db));
        });

        // Stores new sharing rules.
        // <param name="request">The new rules.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="vault">The vault service, for the vault list.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/settings", (ShareSettings request, HttpContext context, ShareService shares, EmailQueue email, VaultService vault, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            if (shares.SaveSettings(request) is { } error)
            {
                return Results.Json(new ErrorResponse("invalid_settings", error), statusCode: StatusCodes.Status400BadRequest);
            }
            audit.Record(context, AuditActions.ShareSettingsChanged, targetType: "settings", targetName: "Sharing",
                details: $"Mode {request.Mode}, up to {request.MaxDays} days and {request.MaxViews} views, password {(request.RequirePassword ? "required" : "optional")}, e-mail link {(request.AllowEmail ? "on" : "off")}, e-mail code {(request.AllowEmailCode ? "on" : "off")}");
            return Results.Ok(BuildAdminView(shares, email, vault, db));
        });

        // Sets one user's sharing mode: default, allowed or blocked.
        // <param name="id">The account's ID.</param>
        // <param name="request">The new mode.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="vault">The vault service, for the vault list.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/users/{id}", (string id, SetShareUserModeRequest request, HttpContext context, ShareService shares, EmailQueue email, VaultService vault, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var target = db.GetUserById(id);
            if (target is null || target.Role != UserRole.User)
            {
                return Results.Json(new ErrorResponse("not_found", "User not found."), statusCode: StatusCodes.Status404NotFound);
            }
            if (request.Mode is not ("default" or "allowed" or "blocked"))
            {
                return Results.Json(new ErrorResponse("invalid_settings", "Sharing must be default, allowed or blocked."), statusCode: StatusCodes.Status400BadRequest);
            }
            db.SetShareUserOverride(id, request.Mode == "default" ? null : request.Mode);
            audit.Record(context, AuditActions.ShareSettingsChanged, targetType: "user", targetId: id, targetName: target.Username, details: $"Sharing {request.Mode}");
            return Results.Ok(BuildAdminView(shares, email, vault, db));
        });

        // Allows or forbids sharing entries of one vault.
        // <param name="id">The vault's ID.</param>
        // <param name="request">Whether sharing is allowed.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="vault">The vault service, for the vault list.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the change.</param>
        group.MapPut("/vaults/{id}", (string id, SetShareVaultRequest request, HttpContext context, ShareService shares, EmailQueue email, VaultService vault, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var file = vault.Get(id);
            if (file is null)
            {
                return Results.Json(new ErrorResponse("not_found", "Vault not found."), statusCode: StatusCodes.Status404NotFound);
            }
            db.SetShareVaultAllowed(id, request.Allowed);
            audit.Record(context, AuditActions.ShareSettingsChanged, targetType: "vault", targetId: id, targetName: file.Name,
                details: $"Sharing from this vault {(request.Allowed ? "allowed" : "forbidden")}");
            return Results.Ok(BuildAdminView(shares, email, vault, db));
        });

        // Revokes any share; the ciphertext is deleted at once.
        // <param name="id">The share's ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
        // <param name="vault">The vault service, for the vault list.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the revocation.</param>
        group.MapDelete("/shares/{id}", (string id, HttpContext context, ShareService shares, EmailQueue email, VaultService vault, KeePortDb db, AuditLog audit) =>
        {
            if (ApiAuth.RequireAdmin(context) is { } forbidden)
            {
                return forbidden;
            }
            var share = db.GetShare(id);
            if (share is null)
            {
                return Results.Json(new ErrorResponse("not_found", "Share not found."), statusCode: StatusCodes.Status404NotFound);
            }
            if (db.RevokeShare(id))
            {
                audit.Record(context, AuditActions.ShareRevoked, targetType: "share", targetId: id, targetName: share.Label, details: $"Owner {share.OwnerName}");
            }
            return Results.Ok(BuildAdminView(shares, email, vault, db));
        });
    }

    /// <summary>Maps the public recipient routes. They need no session; each one is rate limited per client address.</summary>
    /// <param name="group">The public share group.</param>
    private static void MapPublic(RouteGroupBuilder group)
    {
        // Returns what the recipient page shows before revealing; does not count a view.
        // <param name="id">The share's ID.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapGet("/{id}", (string id, ShareService shares, KeePortDb db) =>
        {
            var share = Available(id, shares, db);
            if (share is null)
            {
                return Unavailable();
            }
            return Results.Ok(new ShareMetaDto(share.OwnerName, share.ExpiresAt, share.MaxViews - share.ViewCount, share.KdfParams is not null,
                share.KdfSalt, share.KdfParams, share.RequireEmailCode, share.RequireEmailCode && share.RecipientEmail is not null ? ShareService.MaskEmail(share.RecipientEmail) : null));
        }).RequireRateLimiting(PublicRateLimitPolicy);

        // Sends a code to the recipient's address when the share asks for one.
        // <param name="id">The share's ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="email">The e-mail queue.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        group.MapPost("/{id}/code", (string id, HttpContext context, ShareService shares, EmailQueue email, KeePortDb db) =>
        {
            var share = Available(id, shares, db);
            if (share is null || !share.RequireEmailCode || share.RecipientEmail is null)
            {
                return Unavailable();
            }
            if (share.CodeSentAt is { } sentAt && DateTimeOffset.UtcNow - sentAt < TimeSpan.FromSeconds(CodeIntervalSeconds))
            {
                return Results.Json(new ErrorResponse("code_too_soon", "Wait a minute before asking for a new code."), statusCode: StatusCodes.Status429TooManyRequests);
            }
            if (share.CodesSent >= ShareService.MaxCodes)
            {
                return Results.Json(new ErrorResponse("too_many_codes", "Too many codes were requested for this secret."), statusCode: StatusCodes.Status429TooManyRequests);
            }
            var owner = db.GetUserById(share.OwnerUserId);
            var code = ShareService.NewCode();
            db.SetShareCode(share.Id, ShareService.HashCode(share.Id, code), DateTimeOffset.UtcNow + CodeLifetime);
            if (!email.Enqueue(EmailTemplates.Kinds.ShareCode, share.RecipientEmail, owner?.Language, new Dictionary<string, string>
                {
                    ["sender"] = share.OwnerName,
                    ["code"] = code
                }))
            {
                return Results.Json(new ErrorResponse("email_not_configured", "E-mail is not set up on this server yet. Ask your administrator."), statusCode: StatusCodes.Status400BadRequest);
            }
            return Results.NoContent();
        }).RequireRateLimiting(PublicRateLimitPolicy);

        // Hands out the ciphertext when the access proof (and the e-mail code, if needed) are right, and counts the view.
        // Wrong proofs and codes are counted; after ten the share is locked and its ciphertext deleted.
        // <param name="id">The share's ID.</param>
        // <param name="request">The access proof and the optional code.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="shares">The sharing rules.</param>
        // <param name="db">The SQLite store for KeePort metadata.</param>
        // <param name="audit">The audit log that records the view or the failed attempt.</param>
        group.MapPost("/{id}/reveal", (string id, RevealShareRequest request, HttpContext context, ShareService shares, KeePortDb db, AuditLog audit) =>
        {
            var share = Available(id, shares, db);
            if (share is null)
            {
                return Unavailable();
            }
            if (share.RequireEmailCode)
            {
                if (share.CodeHash is null || share.CodeExpiresAt is not { } codeExpires || codeExpires <= DateTimeOffset.UtcNow)
                {
                    return Results.Json(new ErrorResponse("code_required", "Ask for a code first."), statusCode: StatusCodes.Status400BadRequest);
                }
                if (!ShareService.CodeMatches(share.Id, request.Code, share.CodeHash))
                {
                    return Failure(share, "wrong_code", "The code is wrong.", context, db, audit);
                }
            }
            if (!ShareService.ProofMatches(request.Proof, share.ProofHash))
            {
                return Failure(share, share.KdfParams is null ? "wrong_link" : "wrong_password",
                    share.KdfParams is null ? "The link is incomplete." : "The password is wrong.", context, db, audit);
            }
            var revealed = db.ConsumeShareView(share.Id, DateTimeOffset.UtcNow);
            if (revealed is not { } result)
            {
                return Unavailable();
            }
            audit.Record(context, AuditActions.ShareViewed, actorName: RecipientName, targetType: "share", targetId: share.Id, targetName: share.Label,
                details: $"Owner {share.OwnerName}; " + (result.Remaining > 0 ? $"{result.Remaining} view(s) left" : "last view, the secret was deleted"));
            return Results.Ok(new RevealShareDto(result.Ciphertext, result.Iv, result.Remaining));
        }).RequireRateLimiting(PublicRateLimitPolicy);
    }

    /// <summary>
    /// Returns a share that can still be opened: active, and its owner may still share from its vault. Everything else
    /// looks the same to the recipient.
    /// </summary>
    /// <param name="id">The share's ID.</param>
    /// <param name="shares">The sharing rules.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    private static ShareRecord? Available(string id, ShareService shares, KeePortDb db)
    {
        if (id.Length is < 16 or > 32)
        {
            return null;
        }
        var share = db.GetShare(id);
        if (share is null || !share.IsActive(DateTimeOffset.UtcNow))
        {
            return null;
        }
        var owner = db.GetUserById(share.OwnerUserId);
        if (owner is null || !shares.MayShare(owner) || (share.VaultFileId is { } vaultId && !shares.VaultAllowsSharing(vaultId)))
        {
            return null;
        }
        return share;
    }

    /// <summary>Counts a wrong proof or code, records it and answers; a locked share answers as unavailable.</summary>
    /// <param name="share">The share.</param>
    /// <param name="code">The error code for the recipient page.</param>
    /// <param name="message">The error message.</param>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="audit">The audit log.</param>
    private static IResult Failure(ShareRecord share, string code, string message, HttpContext context, KeePortDb db, AuditLog audit)
    {
        var locked = db.CountShareFailure(share.Id, ShareService.MaxFailedAttempts);
        audit.Record(context, AuditActions.ShareViewed, success: false, actorName: RecipientName, targetType: "share", targetId: share.Id, targetName: share.Label,
            details: $"Owner {share.OwnerName}; {message}" + (locked ? " The secret was locked and deleted." : string.Empty));
        return locked ? Unavailable() : Results.Json(new ErrorResponse(code, message), statusCode: StatusCodes.Status403Forbidden);
    }

    /// <summary>Builds the admin view of sharing.</summary>
    /// <param name="shares">The sharing rules.</param>
    /// <param name="email">The e-mail queue, to know whether e-mail is set up.</param>
    /// <param name="vault">The vault service, for the vault list.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    private static AdminSharingDto BuildAdminView(ShareService shares, EmailQueue email, VaultService vault, KeePortDb db)
    {
        var overrides = db.ListShareUserOverrides();
        var blocked = db.ListShareVaultBlocks();
        var now = DateTimeOffset.UtcNow;
        var users = db.ListUsers().Where(/* Only vault users can share. */ user => user.Role == UserRole.User)
            .OrderBy(/* Name. */ user => user.Username, StringComparer.OrdinalIgnoreCase)
            .Select(/* User. */ user => new ShareUserAccessDto(user.Id, user.Username, overrides.GetValueOrDefault(user.Id) ?? "default", shares.MayShare(user)))
            .ToList();
        var vaults = vault.ListAll(includeDeleted: false).OrderBy(/* Name. */ file => file.Name, StringComparer.OrdinalIgnoreCase)
            .Select(/* Vault. */ file => new ShareVaultAccessDto(file.Id, file.Name, !blocked.Contains(file.Id)))
            .ToList();
        return new AdminSharingDto(shares.GetSettings(), email.IsConfigured, users, vaults, db.ListShares(null).Select(/* Share. */ share => ToDto(share, now)).ToList());
    }

    /// <summary>Converts a share into its list representation.</summary>
    /// <param name="share">The stored share.</param>
    /// <param name="now">The current time, for the status.</param>
    private static ShareDto ToDto(ShareRecord share, DateTimeOffset now)
    {
        var status = share.IsActive(now) ? "active"
            : share.RevokedAt is not null ? "revoked"
            : share.EndReason == "locked" ? "locked"
            : share.ViewCount >= share.MaxViews ? "used"
            : "expired";
        return new ShareDto(share.Id, share.Label, share.OwnerName, share.VaultName, share.CreatedAt, share.ExpiresAt, share.MaxViews, share.ViewCount,
            status, share.KdfParams is not null, share.RecipientEmail, share.RequireEmailCode, share.SentByEmail, share.LastViewedAt);
    }

    /// <summary>Answers 403 with an error code and message.</summary>
    /// <param name="code">The error code.</param>
    /// <param name="message">The message.</param>
    private static IResult Forbidden(string code, string message) => Results.Json(new ErrorResponse(code, message), statusCode: StatusCodes.Status403Forbidden);

    /// <summary>Answers 400 with a message.</summary>
    /// <param name="message">The message.</param>
    private static IResult BadRequest(string message) => Results.Json(new ErrorResponse("invalid_share", message), statusCode: StatusCodes.Status400BadRequest);
}
