using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Security;

/// <summary>
/// Chooses Cache-Control headers for the web frontends: entry points such as index.html must be revalidated on every
/// load so browsers pick up a new release right after an update, while Vite's content-hashed files under /assets/
/// never change and can be cached for a year.
/// </summary>
public static class StaticFileCaching
{
    /// <summary>Header value for files that must be revalidated on every request.</summary>
    public const string Revalidate = "no-cache";

    /// <summary>Header value for content-hashed build output.</summary>
    public const string Immutable = "public, max-age=31536000, immutable";

    /// <summary>Returns the Cache-Control value for a static file request path.</summary>
    /// <param name="path">The request path, e.g. /assets/index-Ab12.js or /admin/index.html.</param>
    public static string For(string? path)
    {
        var value = path ?? string.Empty;
        return value.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase) ||
               value.StartsWith("/admin/assets/", StringComparison.OrdinalIgnoreCase)
            ? Immutable
            : Revalidate;
    }

    /// <summary>Sets the Cache-Control header for the current response based on its request path.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    public static void Apply(HttpContext context)
        => context.Response.Headers.CacheControl = For(context.Request.Path.Value);
}
