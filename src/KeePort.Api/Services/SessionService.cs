using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using KeePort.Api.Data;
using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Services;

public sealed class SessionService
{
    public const string CookieName = "keeport_session";
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

    public (SessionRecord Session, string Token, string CsrfToken) CreateSession(UserRecord user, HttpContext context)
    {
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        var csrfToken = Base64Url(RandomNumberGenerator.GetBytes(32));
        var now = DateTimeOffset.UtcNow;
        var session = new SessionRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            UserId = user.Id,
            TokenHash = HashToken(token),
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

    public SessionRecord? ValidateSessionToken(string? token, HttpContext context)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        var session = _db.GetSessionByTokenHash(HashToken(token));
        if (session?.User is null || session.User.Disabled || session.ExpiresAt <= DateTimeOffset.UtcNow)
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

    public void SetSessionCookie(HttpContext context, string token, bool secure)
    {
        context.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.Add(_sessionLifetime)
        });
    }

    public void ClearSessionCookie(HttpContext context, bool secure)
    {
        context.Response.Cookies.Delete(CookieName, new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = "/"
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

    public static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
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
