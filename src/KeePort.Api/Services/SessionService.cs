using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using KeePort.Api.Data;
using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Services;

public sealed class SessionService
{
    public const string AdminApiPath = "/api/admin";
    private const string VaultCookieName = "keeport_session";
    private const string AdminCookieName = "keeport_admin_session";
    public const string SessionItemKey = "KeePort.Session";
    public const string UserItemKey = "KeePort.User";

    private readonly KeePortDb _db;
    private readonly TimeSpan _sessionLifetime;

    public SessionService(KeePortDb db, IConfiguration configuration)
    {
        _db = db;
        var hours = configuration.GetValue("KeePort:SessionHours", 12);
        _sessionLifetime = TimeSpan.FromHours(Math.Clamp(hours, 1, 24 * 30));
    }

    /// <summary>Returns the cookie name for the requested account role.</summary>
    public static string GetCookieName(UserRole role) => role == UserRole.Admin ? AdminCookieName : VaultCookieName;

    public (SessionRecord Session, string Token, string CsrfToken) CreateSession(UserRecord user, HttpContext context)
    {
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        var csrfToken = Base64Url(RandomNumberGenerator.GetBytes(32));
        var now = DateTimeOffset.UtcNow;
        var session = new SessionRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            UserId = user.Id,
            TokenHash = HashToken(token, user.Role),
            CsrfToken = csrfToken,
            CreatedAt = now,
            ExpiresAt = now.Add(_sessionLifetime),
            LastSeenAt = now,
            UserAgent = context.Request.Headers.UserAgent.ToString(),
            IpAddress = context.Connection.RemoteIpAddress?.ToString()
        };
        _db.CreateSession(session);
        return (session, token, csrfToken);
    }

    public SessionRecord? ValidateSessionToken(string? token, UserRole role)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        var session = _db.GetSessionByTokenHash(HashToken(token, role));
        if (session?.User is null || session.User.Role != role || session.User.Disabled || session.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        var shouldTouch = session.LastSeenAt is null || now - session.LastSeenAt.Value > TimeSpan.FromMinutes(5);
        var remaining = session.ExpiresAt - now;
        var shouldExtend = remaining < TimeSpan.FromTicks(_sessionLifetime.Ticks / 2);
        if (shouldTouch || shouldExtend)
        {
            var expiresAt = shouldExtend ? now.Add(_sessionLifetime) : session.ExpiresAt;
            _db.TouchSession(session.Id, now, expiresAt);
            session = session with { LastSeenAt = now, ExpiresAt = expiresAt };
        }

        return session;
    }

    public void SetSessionCookie(HttpContext context, string token, UserRole role, bool secure)
    {
        context.Response.Cookies.Append(GetCookieName(role), token, new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = role == UserRole.Admin ? AdminApiPath : "/",
            Expires = DateTimeOffset.UtcNow.Add(_sessionLifetime)
        });
    }

    public void ClearSessionCookie(HttpContext context, UserRole role, bool secure)
    {
        context.Response.Cookies.Delete(GetCookieName(role), new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = role == UserRole.Admin ? AdminApiPath : "/"
        });
    }

    public bool ValidateCsrfToken(SessionRecord session, string? headerToken)
    {
        if (string.IsNullOrEmpty(headerToken))
        {
            return false;
        }

        var expected = Encoding.UTF8.GetBytes(session.CsrfToken);
        var actual = Encoding.UTF8.GetBytes(headerToken);
        return expected.Length == actual.Length && CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    /// <summary>Separates admin token hashes from existing Vault token hashes.</summary>
    private static string HashToken(string token, UserRole role)
    {
        var value = role == UserRole.Admin ? $"admin:{token}" : token;
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static ClaimsPrincipal CreatePrincipal(UserRecord user)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role.ToString())
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "KeePortSession"));
    }
}
