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

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});

var corsOrigins = builder.Configuration.GetSection("KeePort:CorsOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
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

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1
});

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

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }))
    .WithName("Health");
app.MapAuthEndpoints();
app.MapVaultEndpoints();
app.MapAdminEndpoints();
app.MapWebDavEndpoints();

app.UseDefaultFiles();
app.UseStaticFiles();
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

public partial class Program;
