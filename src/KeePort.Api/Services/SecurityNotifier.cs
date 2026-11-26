using System.Text.RegularExpressions;
using KeePort.Api.Data;
using KeePort.Api.Security;
using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Services;

/// <summary>
/// Sends security notifications to account owners: sign-ins from a new browser, password and e-mail changes, and new
/// WebDAV app passwords. Only confirmed addresses get e-mails; sending never changes the outcome of the action.
/// </summary>
/// <param name="queue">The e-mail queue.</param>
/// <param name="db">The SQLite store for KeePort metadata.</param>
/// <param name="logger">The container log for failures.</param>
public sealed partial class SecurityNotifier(EmailQueue queue, KeePortDb db, ILogger<SecurityNotifier> logger)
{
    /// <summary>How long a browser counts as known after its last successful sign-in.</summary>
    private const int KnownBrowserDays = 90;

    /// <summary>
    /// Notifies about a successful sign-in from a browser the account has not used in the last 90 days. Call it before
    /// the sign-in is written to the audit log. The very first sign-in of an account is not reported.
    /// </summary>
    /// <param name="user">The account, as it was before this sign-in.</param>
    /// <param name="context">The sign-in request, for browser and IP address.</param>
    public void SignedIn(UserRecord user, HttpContext context)
    {
        if (!user.NotifySignIn || !CanNotify(user) || user.LastLoginAt is null)
        {
            return;
        }
        Try(() =>
        {
            var userAgent = Shorten(context.Request.Headers.UserAgent.ToString());
            if (db.HasSignedInWith(user.Id, userAgent, KnownBrowserDays))
            {
                return;
            }
            queue.Enqueue(EmailTemplates.Kinds.SignIn, user.Email!, user.Language, new Dictionary<string, string>
            {
                ["username"] = user.Username,
                ["time"] = EmailTemplates.FormatTime(DateTimeOffset.UtcNow),
                ["device"] = DescribeBrowser(userAgent),
                ["ip"] = ClientIp.Format(context.Connection.RemoteIpAddress) ?? "?"
            });
        });
    }

    /// <summary>Notifies that the account password changed; this cannot be turned off.</summary>
    /// <param name="user">The account.</param>
    /// <param name="kind">One of the PasswordChanged kinds in <see cref="EmailTemplates.Kinds"/>.</param>
    public void PasswordChanged(UserRecord user, string kind)
    {
        if (CanNotify(user))
        {
            Try(() => queue.Enqueue(kind, user.Email!, user.Language, new Dictionary<string, string> { ["username"] = user.Username }));
        }
    }

    /// <summary>Notifies the previous, confirmed address that the e-mail address was changed.</summary>
    /// <param name="user">The account before the change.</param>
    /// <param name="newEmail">The new address.</param>
    public void EmailChanged(UserRecord user, string newEmail)
    {
        if (CanNotify(user))
        {
            Try(() => queue.Enqueue(EmailTemplates.Kinds.EmailChanged, user.Email!, user.Language,
                new Dictionary<string, string> { ["username"] = user.Username, ["email"] = newEmail }));
        }
    }

    /// <summary>Notifies that a second factor was added, removed or reset; this cannot be turned off.</summary>
    /// <param name="user">The account.</param>
    /// <param name="kind">MfaEnabled, MfaDisabled or MfaReset from <see cref="EmailTemplates.Kinds"/>.</param>
    public void MfaChanged(UserRecord user, string kind)
    {
        if (CanNotify(user))
        {
            Try(() => queue.Enqueue(kind, user.Email!, user.Language, new Dictionary<string, string> { ["username"] = user.Username }));
        }
    }

    /// <summary>Notifies that an administrator created a WebDAV app password for the account.</summary>
    /// <param name="user">The account.</param>
    /// <param name="label">The app password's label.</param>
    public void AppPasswordCreated(UserRecord user, string label)
    {
        if (user.NotifyAppPassword && CanNotify(user))
        {
            Try(() => queue.Enqueue(EmailTemplates.Kinds.AppPassword, user.Email!, user.Language,
                new Dictionary<string, string> { ["username"] = user.Username, ["label"] = label }));
        }
    }

    /// <summary>Whether the account has a confirmed address to write to.</summary>
    /// <param name="user">The account.</param>
    private static bool CanNotify(UserRecord user) => user.Email is not null && user.EmailVerifiedAt is not null;

    /// <summary>Runs a notification and logs instead of throwing, so the action itself is never affected.</summary>
    /// <param name="action">The notification to queue.</param>
    private void Try(Action action)
    {
        try
        {
            action();
        }
        catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException or FormatException)
        {
            logger.LogWarning(ex, "Could not queue a security notification.");
        }
    }

    /// <summary>Shortens a user agent the same way the audit log stores it, so both can be compared.</summary>
    /// <param name="userAgent">The User-Agent header.</param>
    private static string? Shorten(string? userAgent)
    {
        var trimmed = userAgent?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }
        return trimmed.Length <= 300 ? trimmed : trimmed[..299] + "…";
    }

    /// <summary>Turns a user agent into "Firefox 120 on Linux"; unknown clients show their first product token.</summary>
    /// <param name="userAgent">The user agent.</param>
    public static string DescribeBrowser(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
        {
            return "?";
        }
        string? browser = null;
        foreach (var (regex, name) in Browsers)
        {
            var match = regex.Match(userAgent);
            if (match.Success)
            {
                browser = $"{name} {match.Groups[1].Value}";
                break;
            }
        }
        var system = Systems.FirstOrDefault(/* First matching system. */ s => s.Regex.IsMatch(userAgent)).Name;
        browser ??= userAgent.StartsWith("Mozilla/", StringComparison.Ordinal) ? "Browser" : userAgent.Split(' ')[0];
        return system is null ? browser : $"{browser} ({system})";
    }

    private static readonly (Regex Regex, string Name)[] Browsers =
    [
        (EdgeRegex(), "Edge"), (OperaRegex(), "Opera"), (FirefoxRegex(), "Firefox"), (ChromeRegex(), "Chrome"), (SafariRegex(), "Safari")
    ];

    private static readonly (Regex Regex, string Name)[] Systems =
    [
        (new Regex(@"\bAndroid\b"), "Android"), (new Regex(@"\b(?:iPhone|iPad|iPod)\b"), "iOS"), (new Regex(@"\bWindows\b"), "Windows"),
        (new Regex(@"\bMac OS X\b|\bMacintosh\b"), "macOS"), (new Regex(@"\bLinux\b"), "Linux")
    ];

    [GeneratedRegex(@"\bEdg(?:e|A|iOS)?/(\d+)")]
    private static partial Regex EdgeRegex();

    [GeneratedRegex(@"\bOPR/(\d+)")]
    private static partial Regex OperaRegex();

    [GeneratedRegex(@"\b(?:Firefox|FxiOS)/(\d+)")]
    private static partial Regex FirefoxRegex();

    [GeneratedRegex(@"(?:\b|Headless)(?:Chrome|CriOS)/(\d+)")]
    private static partial Regex ChromeRegex();

    [GeneratedRegex(@"\bVersion/(\d+)[.\d]* (?:Mobile/\S+ )?Safari/")]
    private static partial Regex SafariRegex();
}
