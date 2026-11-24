using System.Globalization;
using System.Threading.RateLimiting;
using KeePort.Api.Data;
using KeePort.Api.Endpoints;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

// Sets Kestrel's maximum request body size for uploads.
// <param name="options">The Kestrel server options for request size limits.</param>
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 200L * 1024 * 1024;
});

var dataDir = builder.Configuration["KeePort:DataDir"] ?? "/data";
try
{
    Directory.CreateDirectory(dataDir);
    var probe = Path.Combine(dataDir, $".keeport-write-test-{Guid.NewGuid():N}");
    await File.WriteAllTextAsync(probe, "ok");
    File.Delete(probe);
}
catch (Exception ex)
{
    Console.Error.WriteLine($"KeePort cannot write to data directory '{dataDir}'. Check the volume mount and UID/GID permissions. Details: {ex.Message}");
    throw;
}

builder.Services.AddSingleton<KeePortDb>();
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddSingleton<SessionService>();
builder.Services.AddSingleton<VaultService>();
builder.Services.AddSingleton<WebDavStagingStore>();
builder.Services.AddSingleton<RateLimitSettingsService>();

// Registers the credential and WebDAV limits and their rejection response.
// <param name="options">The middleware settings for limiter policies and rejection handling.</param>
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Reads the current credential quota and partitions it by client IP and policy revision.
    // <param name="context">The current HTTP request and response context.</param>
    options.AddPolicy(AuthEndpoints.CredentialRateLimitPolicy, context =>
    {
        var limits = context.RequestServices.GetRequiredService<RateLimitSettingsService>().Current;
        return PerIpLimit(context, limits.Settings.AuthPerMinute, limits.AuthVersion);
    });
   // Applies the WebDAV quota only to requests under the WebDAV path.
    // <param name="context">The current HTTP request and response context.</param>
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, (string, long)>(context =>
    {
        if (!context.Request.Path.StartsWithSegments("/webdav", StringComparison.OrdinalIgnoreCase))
        {
            return RateLimitPartition.GetNoLimiter(("non-webdav", 0L));
        }
        var limits = context.RequestServices.GetRequiredService<RateLimitSettingsService>().Current;
        return PerIpLimit(context, limits.Settings.WebDavPerMinute, limits.WebDavVersion);
    });
    // Returns a structured rate-limit error and includes Retry-After when available.
    // <param name="rejection">The rejected request and rate-limit lease used to build the error response.</param>
    // <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    options.OnRejected = async (rejection, cancellationToken) =>
    {
        if (rejection.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            rejection.HttpContext.Response.Headers.RetryAfter = Math.Max(1, Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        }
        await rejection.HttpContext.Response.WriteAsJsonAsync(
            new ErrorResponse("rate_limited", "Too many requests. Wait and try again."), cancellationToken);
    };
});

TrustedProxyList trustedProxies;
try
{
    trustedProxies = TrustedProxyList.Parse(builder.Configuration["KeePort:TrustedProxies"]);
}
catch (TrustedProxyConfigurationException ex)
{
    Console.Error.WriteLine($"KeePort cannot start: invalid KEEPORT_TRUSTED_PROXIES (KeePort:TrustedProxies). {ex.Message}");
    throw;
}

var corsOrigins = builder.Configuration.GetSection("KeePort:CorsOrigins").Get<string[]>() ?? [];
// Registers the KeePort CORS policy.
// <param name="options">The CORS options on which to register KeePort's named policy.</param>
builder.Services.AddCors(options =>
{
    // Allows credentialed requests only from explicitly configured origins.
    // <param name="policy">The CORS policy builder for the configured origins.</param>
    options.AddPolicy("KeePortCors", policy =>
    {
        if (corsOrigins.Length > 0)
        {
            policy.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
        }
    });
});

var app = builder.Build();
var db = app.Services.GetRequiredService<KeePortDb>();
var sessions = app.Services.GetRequiredService<SessionService>();
var hasher = app.Services.GetRequiredService<PasswordHasher>();
var secureCookies = app.Configuration.GetValue("KeePort:CookieSecure", true);

try
{
    db.Initialize();
    _ = app.Services.GetRequiredService<RateLimitSettingsService>();
}
catch (Exception ex)
{
    app.Logger.LogCritical(ex, "KeePort failed to initialize the database in {DataDir}. Check the volume mount and UID/GID permissions.", dataDir);
    throw;
}

if (!db.HasAdmin() && db.GetSetupToken() is { } setupToken)
{
    app.Logger.LogWarning("KeePort first-run setup required. Open the admin UI and enter this one-time setup token: {SetupToken}", setupToken);
}

var forwardedHeaders = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1
};
trustedProxies.ApplyTo(forwardedHeaders);
app.Logger.LogInformation("Accepting X-Forwarded-For/-Proto from: {TrustedProxies}", trustedProxies.Describe());
app.UseForwardedHeaders(forwardedHeaders);
app.UseForwardedHeaderDiagnostics();

// Sets security headers and chooses a content policy for the API or the frontend.
// <param name="context">The current HTTP request and response context.</param>
// <param name="next">The next middleware in the request pipeline.</param>
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? string.Empty;
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.ContentSecurityPolicy = path.StartsWith("/api", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/webdav", StringComparison.OrdinalIgnoreCase)
        ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    await next();
});

var adminPorts = app.Configuration.GetSection("KeePort:AdminPorts").Get<int[]>() ?? [];
if (adminPorts.Length > 0)
{
    // Restricts access to admin routes to the configured listener ports.
    // <param name="context">The current HTTP request and response context.</param>
    // <param name="next">The next middleware in the request pipeline.</param>
    app.Use(async (context, next) =>
    {
        var path = context.Request.Path.Value ?? string.Empty;
        var isAdminPath = path.Equals("/admin", StringComparison.OrdinalIgnoreCase) ||
                           path.StartsWith("/admin/", StringComparison.OrdinalIgnoreCase) ||
                           path.Equals("/api/admin", StringComparison.OrdinalIgnoreCase) ||
                           path.StartsWith("/api/admin/", StringComparison.OrdinalIgnoreCase);
        if (isAdminPath && !adminPorts.Contains(context.Connection.LocalPort))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        await next();
    });
}

app.UseRateLimiter();
app.UseCors("KeePortCors");
app.UseKeePortSession(sessions, secureCookies);
app.UseKeePortCsrf(sessions);
app.UseWebDavAuthentication(db, hasher);

// Reports process health with the current UTC time.
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }))
    .WithName("Health");
app.MapAuthEndpoints();
app.MapVaultEndpoints();
app.MapAdminEndpoints();
app.MapWebDavEndpoints();

app.UseDefaultFiles();
app.UseStaticFiles();
// Serves the appropriate frontend entry point for eligible unmatched routes.
// <param name="context">The current HTTP request and response context.</param>
// <param name="next">The next middleware in the request pipeline.</param>
app.Use(async (context, next) =>
{
    await next();
    var path = context.Request.Path.Value ?? string.Empty;
    if (context.Response.StatusCode != StatusCodes.Status404NotFound || context.Response.HasStarted ||
        path.StartsWith("/api", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/webdav", StringComparison.OrdinalIgnoreCase))
    {
        return;
    }

    var isAdmin = path.Equals("/admin", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/admin/", StringComparison.OrdinalIgnoreCase);
    var indexPath = isAdmin
        ? Path.Combine(app.Environment.ContentRootPath, "wwwroot", "admin", "index.html")
        : Path.Combine(app.Environment.ContentRootPath, "wwwroot", "index.html");
    if (!File.Exists(indexPath))
    {
        return;
    }

    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "text/html; charset=utf-8";
    context.Response.ContentLength = new FileInfo(indexPath).Length;
    await context.Response.SendFileAsync(indexPath, context.RequestAborted);
});

app.Run();

// Creates a one-minute quota for each client address and settings revision.
// <param name="context">The current HTTP request and response context.</param>
// <param name="limit">The requests allowed per client IP in a one-minute window.</param>
// <param name="version">The policy revision used to separate old and new quota partitions.</param>
static RateLimitPartition<(string, long)> PerIpLimit(HttpContext context, int limit, long version)
    => RateLimitPartition.GetFixedWindowLimiter(
        (ClientIp.Format(context.Connection.RemoteIpAddress) ?? "unknown", version),
        // Configures the one-minute partition to reject requests instead of queueing them.
        // <param name="_">The partition key, unused because quota settings are already captured.</param>
        _ => new FixedWindowRateLimiterOptions { PermitLimit = limit, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 });

public partial class Program;
