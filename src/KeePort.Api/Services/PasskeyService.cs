using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Objects;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>The domain and origin passkeys are created for and checked against.</summary>
/// <param name="RpId">The relying party ID: the domain name.</param>
/// <param name="Origins">The origins the browser may report, e.g. https://vault.example.com.</param>
public sealed record RelyingParty(string RpId, IReadOnlySet<string> Origins);

/// <summary>A started WebAuthn ceremony: the ID the browser sends back and the options for the browser.</summary>
/// <param name="ChallengeId">The one-time ID of the ceremony.</param>
/// <param name="Options">The options for navigator.credentials.create() or .get(), as JSON.</param>
public sealed record PasskeyCeremony(string ChallengeId, JsonElement Options);

/// <summary>Raised when a passkey cannot be used; the message is shown to the user.</summary>
/// <param name="message">What went wrong, in English for the server-error catalog.</param>
public sealed class PasskeyException(string message) : Exception(message);

/// <summary>
/// Passkeys (WebAuthn) with the Fido2 library: adding a passkey to an account, signing in with one without username and
/// password, and using one as second factor. Attestation is not checked ("none"); the domain is the one the page was
/// opened with, unless KeePort:PasskeyRpId and KeePort:PasskeyOrigins set it.
/// </summary>
public sealed class PasskeyService
{
    /// <summary>How long a started ceremony waits for the browser.</summary>
    public static readonly TimeSpan CeremonyLifetime = TimeSpan.FromMinutes(5);

    /// <summary>The message for every failed check, so answers reveal nothing about accounts or passkeys.</summary>
    public const string CheckFailed = "The passkey could not be checked. Try again.";

    private const string NeedsDomain = "Passkeys need the address with a domain name and HTTPS, not an IP address.";
    private readonly KeePortDb _db;
    private readonly string? _configuredRpId;
    private readonly HashSet<string> _configuredOrigins;

    /// <summary>Creates the service and reads the optional fixed domain and origins.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="configuration">The configuration with KeePort:PasskeyRpId and KeePort:PasskeyOrigins.</param>
    public PasskeyService(KeePortDb db, IConfiguration configuration)
    {
        _db = db;
        _configuredRpId = string.IsNullOrWhiteSpace(configuration["KeePort:PasskeyRpId"]) ? null : configuration["KeePort:PasskeyRpId"]!.Trim();
        _configuredOrigins = (configuration["KeePort:PasskeyOrigins"] ?? string.Empty)
            .Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(/* Without a trailing slash. */ origin => origin.TrimEnd('/'))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Works out the domain and origin for a request: the fixed settings if given, otherwise the page's origin. An IP
    /// address or plain HTTP (except localhost) is refused, because browsers do not offer passkeys there.
    /// </summary>
    /// <param name="context">The request.</param>
    /// <exception cref="PasskeyException">The page has no domain name or no HTTPS.</exception>
    public RelyingParty Resolve(HttpContext context)
    {
        var originHeader = context.Request.Headers.Origin.ToString();
        var origin = string.IsNullOrEmpty(originHeader) ? $"{context.Request.Scheme}://{context.Request.Host}" : originHeader.TrimEnd('/');
        if (_configuredOrigins.Count > 0)
        {
            var rpId = _configuredRpId ?? new Uri(_configuredOrigins.First()).Host;
            return new RelyingParty(rpId, _configuredOrigins);
        }
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || IPAddress.TryParse(uri.Host.Trim('[', ']'), out _))
        {
            throw new PasskeyException(NeedsDomain);
        }
        var localhost = uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase);
        if (uri.Scheme != Uri.UriSchemeHttps && !localhost)
        {
            throw new PasskeyException(NeedsDomain);
        }
        return new RelyingParty(_configuredRpId ?? uri.Host, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { uri.GetLeftPart(UriPartial.Authority) });
    }

    /// <summary>Starts adding a passkey to an account.</summary>
    /// <param name="user">The signed-in account.</param>
    /// <param name="context">The request.</param>
    public PasskeyCeremony StartRegistration(UserRecord user, HttpContext context)
    {
        var rp = Resolve(context);
        var exclude = _db.ListPasskeys(user.Id).Where(/* Same domain. */ p => p.RpId == rp.RpId)
            .Select(/* Descriptor. */ p => new PublicKeyCredentialDescriptor(KeePortDb.Base64UrlDecode(p.CredentialId))).ToList();
        var options = Fido(rp).RequestNewCredential(new RequestNewCredentialParams
        {
            User = new Fido2User { Id = UserHandle(user), Name = user.Username, DisplayName = user.Username },
            ExcludeCredentials = exclude,
            AuthenticatorSelection = new AuthenticatorSelection { ResidentKey = ResidentKeyRequirement.Preferred, UserVerification = UserVerificationRequirement.Preferred },
            AttestationPreference = AttestationConveyancePreference.None
        });
        return Store("register", user.Id, user.Role, options.ToJson());
    }

    /// <summary>Checks the browser's answer and stores the new passkey.</summary>
    /// <param name="user">The signed-in account.</param>
    /// <param name="challengeId">The ID from <see cref="StartRegistration"/>.</param>
    /// <param name="response">The browser's answer.</param>
    /// <param name="name">The name for the passkey.</param>
    /// <param name="context">The request.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <exception cref="PasskeyException">The answer is invalid.</exception>
    public async Task<PasskeyRecord> FinishRegistrationAsync(UserRecord user, string? challengeId, JsonElement response, string? name, HttpContext context, CancellationToken cancellationToken)
    {
        var challenge = Take(challengeId);
        if (challenge is null || challenge.Purpose != "register" || challenge.UserId != user.Id)
        {
            throw new PasskeyException(CheckFailed);
        }
        var rp = Resolve(context);
        RegisteredPublicKeyCredential credential;
        try
        {
            var raw = response.Deserialize<AuthenticatorAttestationRawResponse>() ?? throw new PasskeyException(CheckFailed);
            credential = await Fido(rp).MakeNewCredentialAsync(new MakeNewCredentialParams
            {
                AttestationResponse = raw,
                OriginalOptions = CredentialCreateOptions.FromJson(challenge.OptionsJson),
                IsCredentialIdUniqueToUserCallback = /* Refuses a passkey that is already stored. */ (args, _) =>
                    Task.FromResult(_db.FindPasskeyByCredentialId(KeePortDb.Base64Url(args.CredentialId)) is null)
            }, cancellationToken);
        }
        catch (Exception ex) when (ex is not PasskeyException and not OperationCanceledException)
        {
            throw new PasskeyException(CheckFailed);
        }
        var cleanName = string.IsNullOrWhiteSpace(name) ? "Passkey" : name.Trim();
        var passkey = new PasskeyRecord(Guid.NewGuid().ToString("N"), user.Id, KeePortDb.Base64Url(credential.Id), credential.PublicKey, credential.SignCount,
            rp.RpId, cleanName.Length > 60 ? cleanName[..60] : cleanName, DateTimeOffset.UtcNow, null);
        _db.AddPasskey(passkey);
        return passkey;
    }

    /// <summary>Starts a sign-in with a passkey, either without username (any passkey of the domain) or as second factor.</summary>
    /// <param name="role">The area.</param>
    /// <param name="user">For the second factor: the account whose password was correct; null for a sign-in without username.</param>
    /// <param name="context">The request.</param>
    public PasskeyCeremony StartLogin(UserRole role, UserRecord? user, HttpContext context)
    {
        var rp = Resolve(context);
        var allowed = user is null ? [] : _db.ListPasskeys(user.Id).Where(/* Same domain. */ p => p.RpId == rp.RpId)
            .Select(/* Descriptor. */ p => new PublicKeyCredentialDescriptor(KeePortDb.Base64UrlDecode(p.CredentialId))).ToList();
        if (user is not null && allowed.Count == 0)
        {
            throw new PasskeyException(CheckFailed);
        }
        var options = Fido(rp).GetAssertionOptions(new GetAssertionOptionsParams
        {
            AllowedCredentials = allowed,
            // Without a password, the passkey alone must prove both factors: possession and fingerprint, face or PIN.
            UserVerification = user is null ? UserVerificationRequirement.Required : UserVerificationRequirement.Preferred
        });
        return Store(user is null ? "login" : "mfa", user?.Id, role, options.ToJson());
    }

    /// <summary>
    /// Checks the browser's answer to a sign-in and returns the account and passkey. The account must belong to the area,
    /// be active and, for a second factor, be the account whose password was correct.
    /// </summary>
    /// <param name="challengeId">The ID from <see cref="StartLogin"/>.</param>
    /// <param name="response">The browser's answer.</param>
    /// <param name="role">The area.</param>
    /// <param name="expectedUserId">For the second factor: the account; null for a sign-in without username.</param>
    /// <param name="context">The request.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    /// <exception cref="PasskeyException">The answer is invalid.</exception>
    public async Task<(UserRecord User, PasskeyRecord Passkey)> FinishLoginAsync(string? challengeId, JsonElement response, UserRole role, string? expectedUserId, HttpContext context, CancellationToken cancellationToken)
    {
        var challenge = Take(challengeId);
        if (challenge is null || challenge.Role != role || challenge.Purpose != (expectedUserId is null ? "login" : "mfa") || challenge.UserId != expectedUserId)
        {
            throw new PasskeyException(CheckFailed);
        }
        var rp = Resolve(context);
        try
        {
            var raw = response.Deserialize<AuthenticatorAssertionRawResponse>() ?? throw new PasskeyException(CheckFailed);
            var passkey = _db.FindPasskeyByCredentialId(KeePortDb.Base64Url(raw.RawId)) ?? throw new PasskeyException(CheckFailed);
            var user = _db.GetUserById(passkey.UserId);
            if (user is null || user.Disabled || user.Role != role || passkey.RpId != rp.RpId || (expectedUserId is not null && user.Id != expectedUserId))
            {
                throw new PasskeyException(CheckFailed);
            }
            var result = await Fido(rp).MakeAssertionAsync(new MakeAssertionParams
            {
                AssertionResponse = raw,
                OriginalOptions = AssertionOptions.FromJson(challenge.OptionsJson),
                StoredPublicKey = passkey.PublicKey,
                StoredSignatureCounter = passkey.SignCount,
                IsUserHandleOwnerOfCredentialIdCallback = /* The passkey must belong to the account it names. */ (args, _) =>
                    Task.FromResult(CryptographicOperations.FixedTimeEquals(args.UserHandle, UserHandle(user)))
            }, cancellationToken);
            _db.TouchPasskey(passkey.Id, result.SignCount);
            return (user, passkey);
        }
        catch (Exception ex) when (ex is not PasskeyException and not OperationCanceledException)
        {
            throw new PasskeyException(CheckFailed);
        }
    }

    /// <summary>The WebAuthn user handle of an account: its ID as UTF-8; it contains nothing personal.</summary>
    /// <param name="user">The account.</param>
    private static byte[] UserHandle(UserRecord user) => Encoding.UTF8.GetBytes(user.Id);

    /// <summary>Creates the Fido2 checker for a domain.</summary>
    /// <param name="rp">The domain and origins.</param>
    private static Fido2 Fido(RelyingParty rp) => new(new Fido2Configuration
    {
        RPID = rp.RpId,
        RPName = "KeePort",
        Origins = rp.Origins,
        Timeout = (uint)CeremonyLifetime.TotalMilliseconds
    }, null!);

    /// <summary>Stores a started ceremony and returns its ID with the options for the browser.</summary>
    /// <param name="purpose">register, login or mfa.</param>
    /// <param name="userId">The account, if known.</param>
    /// <param name="role">The area.</param>
    /// <param name="optionsJson">The options.</param>
    private PasskeyCeremony Store(string purpose, string? userId, UserRole role, string optionsJson)
    {
        var id = KeePortDb.Base64Url(RandomNumberGenerator.GetBytes(32));
        _db.CreatePasskeyChallenge(Hash(id), new PasskeyChallengeRecord(purpose, userId, role, optionsJson), DateTimeOffset.UtcNow + CeremonyLifetime);
        using var document = JsonDocument.Parse(optionsJson);
        return new PasskeyCeremony(id, document.RootElement.Clone());
    }

    /// <summary>Takes a started ceremony by its ID, so it can be answered only once.</summary>
    /// <param name="challengeId">The ID.</param>
    private PasskeyChallengeRecord? Take(string? challengeId)
        => string.IsNullOrWhiteSpace(challengeId) || challengeId.Length > 100 ? null : _db.TakePasskeyChallenge(Hash(challengeId.Trim()));

    /// <summary>Returns the hex SHA-256 of a value.</summary>
    /// <param name="value">The value.</param>
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
