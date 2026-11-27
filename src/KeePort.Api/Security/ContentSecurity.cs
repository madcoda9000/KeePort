namespace KeePort.Api.Security;

/// <summary>
/// Chooses the Content-Security-Policy per request path. The web vault may show website icons and check passwords
/// against "Have I Been Pwned" when a user opted in, so only its pages allow HTTPS images and that one API; the admin
/// console and the APIs do not.
/// </summary>
public static class ContentSecurity
{
    /// <summary>The policy for API and WebDAV responses, which never render HTML.</summary>
    public const string Api = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

    /// <summary>The policy for the admin console: images only from KeePort itself and data URLs.</summary>
    public const string Admin = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

    /// <summary>
    /// The policy for the web vault: like the admin console, plus HTTPS images for opt-in website icons and the
    /// "Have I Been Pwned" range API for the opt-in breach check.
    /// </summary>
    public const string Vault = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.pwnedpasswords.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

    /// <summary>
    /// The policy for the page that opens a shared secret: only KeePort's own scripts, styles and API, no outside images
    /// or connections, so nothing on the page can send the decrypted secret anywhere.
    /// </summary>
    public const string Share = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

    /// <summary>Returns the Content-Security-Policy for a request path.</summary>
    /// <param name="path">The request path, e.g. /, /admin/ or /api/vault/files.</param>
    public static string For(string? path)
    {
        var value = path ?? string.Empty;
        if (value.StartsWith("/api", StringComparison.OrdinalIgnoreCase) || value.StartsWith("/webdav", StringComparison.OrdinalIgnoreCase))
        {
            return Api;
        }
        if (IsSharePage(value))
        {
            return Share;
        }
        return value.Equals("/admin", StringComparison.OrdinalIgnoreCase) || value.StartsWith("/admin/", StringComparison.OrdinalIgnoreCase)
            ? Admin
            : Vault;
    }

    /// <summary>Tells whether a path is the page that opens a shared secret (/s/&lt;id&gt; or its HTML file).</summary>
    /// <param name="path">The request path.</param>
    public static bool IsSharePage(string? path)
    {
        var value = path ?? string.Empty;
        return value.StartsWith("/s/", StringComparison.OrdinalIgnoreCase) || value.Equals("/share.html", StringComparison.OrdinalIgnoreCase);
    }
}
