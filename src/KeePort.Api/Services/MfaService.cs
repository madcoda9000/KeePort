using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using KeePort.Api.Data;
using Microsoft.AspNetCore.DataProtection;

namespace KeePort.Api.Services;

/// <summary>The administrator's two-factor rules.</summary>
/// <param name="RequireForAdmins">Administrators must set up a second factor before they can work.</param>
/// <param name="RequireForUsers">Users must set up a second factor before they can work.</param>
/// <param name="EmailForAdmins">Administrators may use codes by e-mail as second factor.</param>
/// <param name="EmailForUsers">Users may use codes by e-mail as second factor.</param>
public sealed record MfaSettings(bool RequireForAdmins, bool RequireForUsers, bool EmailForAdmins, bool EmailForUsers)
{
    /// <summary>The rules before an administrator changed them: nothing required, e-mail codes only for users.</summary>
    public static MfaSettings Default { get; } = new(false, false, false, true);
}

/// <summary>The outcome of checking a second-factor code during sign-in.</summary>
public enum MfaCheck
{
    Valid,
    Wrong,
    MethodNotAvailable
}

/// <summary>The second-factor methods of KeePort.</summary>
public static class MfaMethods
{
    public const string Totp = "totp";
    public const string Email = "email";
    public const string Recovery = "recovery";
}

/// <summary>
/// Two-factor sign-in: TOTP from an authenticator app, codes by e-mail, recovery codes, pending sign-ins between
/// password and code, and the administrator's rules. TOTP secrets are encrypted with ASP.NET Core Data Protection
/// (keys in /data/keys); recovery codes, e-mail codes and pending sign-in tokens are stored only as SHA-256 hashes.
/// </summary>
public sealed class MfaService
{
    /// <summary>How long the second step of a sign-in may take.</summary>
    public static readonly TimeSpan PendingLifetime = TimeSpan.FromMinutes(10);

    /// <summary>How long a sign-in code sent by e-mail works.</summary>
    public static readonly TimeSpan EmailCodeLifetime = TimeSpan.FromMinutes(10);

    /// <summary>How many wrong codes a pending sign-in allows before the password must be entered again.</summary>
    public const int MaxAttempts = 5;

    /// <summary>How many recovery codes an account gets.</summary>
    public const int RecoveryCodeCount = 10;

    private const string StateKey = "mfa_settings";
    private const string RecoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly KeePortDb _db;
    private readonly IDataProtector _protector;

    /// <summary>Creates the service.</summary>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="protection">The Data Protection provider used to encrypt TOTP secrets.</param>
    public MfaService(KeePortDb db, IDataProtectionProvider protection)
    {
        _db = db;
        _protector = protection.CreateProtector("KeePort.Mfa.TotpSecret");
    }

    /// <summary>Reads the administrator's rules, or the defaults when none were saved.</summary>
    public MfaSettings GetSettings()
    {
        var json = _db.GetState(StateKey);
        if (json is null)
        {
            return MfaSettings.Default;
        }
        try
        {
            return JsonSerializer.Deserialize<MfaSettings>(json, Json) ?? MfaSettings.Default;
        }
        catch (JsonException)
        {
            return MfaSettings.Default;
        }
    }

    /// <summary>Stores the administrator's rules.</summary>
    /// <param name="settings">The new rules.</param>
    public void SaveSettings(MfaSettings settings) => _db.SetState(StateKey, JsonSerializer.Serialize(settings, Json));

    /// <summary>Whether accounts of a role may use codes by e-mail as second factor.</summary>
    /// <param name="role">The account role.</param>
    /// <param name="settings">The rules, or null to read them.</param>
    public bool EmailAllowed(UserRole role, MfaSettings? settings = null)
    {
        settings ??= GetSettings();
        return role == UserRole.Admin ? settings.EmailForAdmins : settings.EmailForUsers;
    }

    /// <summary>Whether accounts of a role must have a second factor.</summary>
    /// <param name="role">The account role.</param>
    /// <param name="settings">The rules, or null to read them.</param>
    public bool Required(UserRole role, MfaSettings? settings = null)
    {
        settings ??= GetSettings();
        return role == UserRole.Admin ? settings.RequireForAdmins : settings.RequireForUsers;
    }

    /// <summary>
    /// Lists the second factors an account can use right now. E-mail codes count only while the rules allow them for
    /// the account's role and the address is confirmed; recovery codes are not listed (they are a fallback).
    /// </summary>
    /// <param name="user">The account.</param>
    /// <param name="settings">The rules, or null to read them.</param>
    public IReadOnlyList<string> Methods(UserRecord user, MfaSettings? settings = null)
    {
        var methods = new List<string>(2);
        if (user.MfaTotpEnabledAt is not null)
        {
            methods.Add(MfaMethods.Totp);
        }
        if (user.MfaEmailEnabledAt is not null && user.Email is not null && user.EmailVerifiedAt is not null && EmailAllowed(user.Role, settings))
        {
            methods.Add(MfaMethods.Email);
        }
        return methods;
    }

    /// <summary>Whether signing in to the account needs a second factor.</summary>
    /// <param name="user">The account.</param>
    /// <param name="settings">The rules, or null to read them.</param>
    public bool IsActive(UserRecord user, MfaSettings? settings = null) => Methods(user, settings).Count > 0;

    /// <summary>Whether the account must set up a second factor before it can do anything else.</summary>
    /// <param name="user">The account.</param>
    public bool SetupRequired(UserRecord user)
    {
        var settings = GetSettings();
        return Required(user.Role, settings) && !IsActive(user, settings);
    }

    /// <summary>Adds the two-factor state to an account's API representation.</summary>
    /// <param name="dto">The representation without it.</param>
    /// <param name="user">The account.</param>
    public UserDto Describe(UserDto dto, UserRecord user)
    {
        var settings = GetSettings();
        var active = IsActive(user, settings);
        return dto with { TwoFactor = active, MfaSetupRequired = Required(user.Role, settings) && !active };
    }

    /// <summary>Starts setting up TOTP: creates a secret that becomes active only after a correct code.</summary>
    /// <param name="user">The account.</param>
    /// <returns>The secret as Base32 text and the otpauth:// link for the QR code.</returns>
    public (string Secret, string Uri) StartTotp(UserRecord user)
    {
        var secret = Totp.GenerateSecret();
        _db.SetPendingTotp(user.Id, _protector.Protect(secret));
        return (secret, Totp.BuildUri("KeePort", user.Username, secret));
    }

    /// <summary>
    /// Finishes setting up TOTP when the code from the app matches the new secret. Returns new recovery codes when the
    /// account had no second factor before, an empty list when it keeps its codes, or null for a wrong code.
    /// </summary>
    /// <param name="user">The account.</param>
    /// <param name="code">The code from the app.</param>
    public IReadOnlyList<string>? ConfirmTotp(UserRecord user, string? code)
    {
        var pending = Reveal(_db.GetMfaSecrets(user.Id).TotpPending);
        if (pending is null || Totp.Verify(pending, code, DateTimeOffset.UtcNow) is not { } step)
        {
            return null;
        }
        var hadFactor = user.MfaTotpEnabledAt is not null || user.MfaEmailEnabledAt is not null;
        _db.EnableTotp(user.Id, _protector.Protect(pending), step);
        return hadFactor && _db.CountRecoveryCodes(user.Id) > 0 ? [] : CreateRecoveryCodes(user.Id);
    }

    /// <summary>
    /// Turns on codes by e-mail. Returns new recovery codes when the account had no second factor before, otherwise an
    /// empty list.
    /// </summary>
    /// <param name="user">The account.</param>
    public IReadOnlyList<string> EnableEmail(UserRecord user)
    {
        var hadFactor = user.MfaTotpEnabledAt is not null || user.MfaEmailEnabledAt is not null;
        _db.SetEmailMfa(user.Id, true);
        return hadFactor && _db.CountRecoveryCodes(user.Id) > 0 ? [] : CreateRecoveryCodes(user.Id);
    }

    /// <summary>Turns off one method; when none is left, the recovery codes are removed too.</summary>
    /// <param name="user">The account before the change.</param>
    /// <param name="method">totp or email.</param>
    public void Disable(UserRecord user, string method)
    {
        if (method == MfaMethods.Totp)
        {
            _db.DisableTotp(user.Id);
        }
        else
        {
            _db.SetEmailMfa(user.Id, false);
        }
        var updated = _db.GetUserById(user.Id);
        if (updated is not null && updated.MfaTotpEnabledAt is null && updated.MfaEmailEnabledAt is null)
        {
            _db.ReplaceRecoveryCodes(user.Id, []);
        }
    }

    /// <summary>Replaces the account's recovery codes with 10 new ones and returns them; only their hashes are stored.</summary>
    /// <param name="userId">The account's ID.</param>
    public IReadOnlyList<string> CreateRecoveryCodes(string userId)
    {
        var codes = Enumerable.Range(0, RecoveryCodeCount).Select(/* One code. */ _ => NewRecoveryCode()).ToList();
        _db.ReplaceRecoveryCodes(userId, codes.Select(/* Hash. */ code => HashRecoveryCode(userId, code)));
        return codes;
    }

    /// <summary>Counts the account's unused recovery codes.</summary>
    /// <param name="userId">The account's ID.</param>
    public int RecoveryCodesLeft(string userId) => _db.CountRecoveryCodes(userId);

    /// <summary>
    /// Checks a second-factor code. A correct TOTP code can be used only once; a recovery code or e-mail code is used up.
    /// </summary>
    /// <param name="user">The account.</param>
    /// <param name="method">totp, email or recovery.</param>
    /// <param name="code">The entered code.</param>
    public MfaCheck Check(UserRecord user, string? method, string? code)
    {
        switch (method)
        {
            case MfaMethods.Totp:
                if (user.MfaTotpEnabledAt is null || Reveal(_db.GetMfaSecrets(user.Id).TotpSecret) is not { } secret)
                {
                    return MfaCheck.MethodNotAvailable;
                }
                return Totp.Verify(secret, code, DateTimeOffset.UtcNow) is { } step && _db.TryUseTotpStep(user.Id, step) ? MfaCheck.Valid : MfaCheck.Wrong;
            case MfaMethods.Email:
                if (!Methods(user).Contains(MfaMethods.Email))
                {
                    return MfaCheck.MethodNotAvailable;
                }
                var digits = (code ?? string.Empty).Trim();
                return digits.Length == 6 && _db.TryUseMfaEmailCode(user.Id, Hash(user.Id + ":" + digits)) ? MfaCheck.Valid : MfaCheck.Wrong;
            case MfaMethods.Recovery:
                var normalized = NormalizeRecoveryCode(code);
                return normalized is not null && _db.TryUseRecoveryCode(user.Id, HashRecoveryCode(user.Id, normalized)) ? MfaCheck.Valid : MfaCheck.Wrong;
            default:
                return MfaCheck.MethodNotAvailable;
        }
    }

    /// <summary>
    /// Creates a sign-in code for e-mail, unless one was sent less than a minute ago or five in the last hour.
    /// </summary>
    /// <param name="userId">The account's ID.</param>
    /// <returns>The code to send, or null when the account has to wait.</returns>
    public string? CreateEmailCode(string userId)
    {
        var now = DateTimeOffset.UtcNow;
        if (_db.CountMfaEmailCodes(userId, now.AddSeconds(-60)) > 0 || _db.CountMfaEmailCodes(userId, now.AddHours(-1)) >= 5)
        {
            return null;
        }
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
        _db.CreateMfaEmailCode(userId, Hash(userId + ":" + code), now + EmailCodeLifetime);
        return code;
    }

    /// <summary>Starts the second step of a sign-in and returns the token the browser sends with the code.</summary>
    /// <param name="user">The account whose password was correct.</param>
    /// <param name="role">The area of the sign-in.</param>
    public string CreatePending(UserRecord user, UserRole role)
    {
        var token = KeePortDb.Base64Url(RandomNumberGenerator.GetBytes(32));
        _db.CreateMfaPending(Hash(token), user.Id, role, DateTimeOffset.UtcNow + PendingLifetime);
        return token;
    }

    /// <summary>Finds an unexpired pending sign-in for the area, or null.</summary>
    /// <param name="token">The token from the browser.</param>
    /// <param name="role">The area the request came to.</param>
    public MfaPendingRecord? FindPending(string? token, UserRole role)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 100)
        {
            return null;
        }
        var pending = _db.FindMfaPending(Hash(token.Trim()));
        return pending is not null && pending.Role == role && pending.Attempts < MaxAttempts ? pending : null;
    }

    /// <summary>Counts a wrong code; after the fifth the pending sign-in is removed. Returns whether it can still be used.</summary>
    /// <param name="pending">The pending sign-in.</param>
    public bool CountFailure(MfaPendingRecord pending)
    {
        if (_db.CountMfaAttempt(pending.TokenHash) >= MaxAttempts)
        {
            _db.DeleteMfaPending(pending.TokenHash);
            return false;
        }
        return true;
    }

    /// <summary>Removes a pending sign-in after it succeeded.</summary>
    /// <param name="pending">The pending sign-in.</param>
    public void Complete(MfaPendingRecord pending) => _db.DeleteMfaPending(pending.TokenHash);

    /// <summary>Shows a masked e-mail address such as "a…@example.org" for the sign-in page.</summary>
    /// <param name="email">The address.</param>
    public static string MaskEmail(string email)
    {
        var at = email.IndexOf('@', StringComparison.Ordinal);
        return at <= 0 ? "…" : email[0] + "…" + email[at..];
    }

    /// <summary>Decrypts a stored TOTP secret, or returns null when none is stored or the keys were lost.</summary>
    /// <param name="protectedSecret">The encrypted secret.</param>
    private string? Reveal(string? protectedSecret)
    {
        if (protectedSecret is null)
        {
            return null;
        }
        try
        {
            return _protector.Unprotect(protectedSecret);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>Creates one recovery code of 80 random bits, e.g. "k7m2-9xq4-ph3d-a8vn".</summary>
    private static string NewRecoveryCode()
    {
        var chars = new char[16];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = RecoveryAlphabet[RandomNumberGenerator.GetInt32(RecoveryAlphabet.Length)];
        }
        var text = new string(chars);
        return $"{text[..4]}-{text[4..8]}-{text[8..12]}-{text[12..]}";
    }

    /// <summary>Brings an entered recovery code into its stored form: lower case with dashes; null when it cannot be one.</summary>
    /// <param name="code">The entered code.</param>
    private static string? NormalizeRecoveryCode(string? code)
    {
        var plain = new string((code ?? string.Empty).ToLowerInvariant().Where(/* Keep letters and digits. */ char.IsAsciiLetterOrDigit).ToArray());
        return plain.Length != 16 ? null : $"{plain[..4]}-{plain[4..8]}-{plain[8..12]}-{plain[12..]}";
    }

    /// <summary>Hashes a recovery code together with the account ID.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="code">The normalized code.</param>
    private static string HashRecoveryCode(string userId, string code) => Hash("recovery:" + userId + ":" + code);

    /// <summary>Returns the hex SHA-256 of a value.</summary>
    /// <param name="value">The value.</param>
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
