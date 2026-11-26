using System.Security.Cryptography;
using System.Text;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>The outcome of checking a verification code.</summary>
public enum CodeCheck
{
    Valid,
    Wrong,
    Expired,
    TooManyAttempts
}

/// <summary>
/// One-time links (invitation, password reset) and 6-digit codes (e-mail confirmation). Only SHA-256 hashes are stored;
/// links carry 256 random bits, codes are bound to the account and allow 5 attempts.
/// </summary>
/// <param name="db">The SQLite store for KeePort metadata.</param>
public sealed class AccountTokens(KeePortDb db)
{
    /// <summary>How long an invitation link works.</summary>
    public static readonly TimeSpan InviteLifetime = TimeSpan.FromHours(48);

    /// <summary>How long a password reset link works.</summary>
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromMinutes(30);

    /// <summary>How long a verification code works.</summary>
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(30);

    private const int MaxCodeAttempts = 5;

    /// <summary>Creates a one-time link token; older unused tokens of the same purpose stop working.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="purpose">invite or reset.</param>
    /// <param name="email">The address the link is sent to.</param>
    /// <param name="lifetime">How long it works.</param>
    /// <returns>The token for the link; it is not stored.</returns>
    public string CreateLink(string userId, string purpose, string? email, TimeSpan lifetime)
    {
        var token = KeePortDb.Base64Url(RandomNumberGenerator.GetBytes(32));
        db.CreateAccountToken(Hash(token), userId, purpose, email, DateTimeOffset.UtcNow + lifetime);
        return token;
    }

    /// <summary>Finds the unused, unexpired token from a link, or null.</summary>
    /// <param name="token">The token from the link.</param>
    /// <param name="purpose">invite or reset.</param>
    public AccountTokenRecord? FindLink(string? token, string purpose)
        => string.IsNullOrWhiteSpace(token) || token.Length > 100 ? null : db.FindAccountToken(Hash(token.Trim()), purpose);

    /// <summary>Marks a link token as used.</summary>
    /// <param name="record">The token.</param>
    public void Use(AccountTokenRecord record) => db.UseAccountToken(record.TokenHash);

    /// <summary>Creates a 6-digit code for confirming an e-mail address; an older code stops working.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="email">The address being confirmed.</param>
    /// <returns>The code to send; it is not stored.</returns>
    public string CreateCode(string userId, string email)
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
        db.CreateAccountToken(Hash(userId + ":" + code), userId, "verify", email, DateTimeOffset.UtcNow + CodeLifetime);
        return code;
    }

    /// <summary>Checks a code; a correct code is used up, a wrong one counts as an attempt.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="code">The code the user entered.</param>
    /// <param name="email">The address the code was sent to, when valid.</param>
    public CodeCheck CheckCode(string userId, string? code, out string? email)
    {
        email = null;
        var record = db.FindVerificationCode(userId);
        if (record is null)
        {
            return CodeCheck.Expired;
        }
        if (record.Attempts >= MaxCodeAttempts)
        {
            return CodeCheck.TooManyAttempts;
        }
        var expected = Encoding.ASCII.GetBytes(record.TokenHash);
        var actual = Encoding.ASCII.GetBytes(Hash(userId + ":" + (code ?? string.Empty).Trim()));
        if (!CryptographicOperations.FixedTimeEquals(expected, actual))
        {
            db.CountAccountTokenAttempt(record.TokenHash);
            return record.Attempts + 1 >= MaxCodeAttempts ? CodeCheck.TooManyAttempts : CodeCheck.Wrong;
        }
        db.UseAccountToken(record.TokenHash);
        email = record.Email;
        return CodeCheck.Valid;
    }

    /// <summary>Returns the hex SHA-256 of a token or code.</summary>
    /// <param name="value">The token or code.</param>
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
