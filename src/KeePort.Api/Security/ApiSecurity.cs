using System.Text;
using KeePort.Api.Data;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Security;

public static class ApiAuth
{
    public static UserRecord? GetUser(HttpContext context) => context.Items[SessionService.UserItemKey] as UserRecord;

    public static SessionRecord? GetSession(HttpContext context) => context.Items[SessionService.SessionItemKey] as SessionRecord;

    public static IResult? RequireAuthenticated(HttpContext context)
    {
        return GetUser(context) is null ? Results.Unauthorized() : null;
    }

    public static IResult? RequireAdmin(HttpContext context)
    {
        var user = GetUser(context);
        if (user is null)
        {
            return Results.Unauthorized();
        }
        if (user.Role != UserRole.Admin)
        {
            return Results.Json(new ErrorResponse("forbidden", "Admin role required."), statusCode: StatusCodes.Status403Forbidden);
        }
        return null;
    }
}

public static class ApiSecurityExtensions
{
    public static IApplicationBuilder UseKeePortSession(this IApplicationBuilder app, SessionService sessions, bool secureCookies)
    {
        return app.Use(async (context, next) =>
        {
            var token = context.Request.Cookies[SessionService.CookieName];
            if (string.IsNullOrEmpty(token))
            {
                await next();
                return;
            }

            var session = sessions.ValidateSessionToken(token, context);
            if (session?.User is null)
            {
                context.Response.Cookies.Delete(SessionService.CookieName, new CookieOptions
                {
                    HttpOnly = true,
                    Secure = secureCookies,
                    SameSite = SameSiteMode.Lax,
                    Path = "/"
                });
                await next();
                return;
            }

            context.User = SessionService.CreatePrincipal(session.User);
            context.Items[SessionService.SessionItemKey] = session;
            context.Items[SessionService.UserItemKey] = session.User;
            await next();
        });
    }

    public static IApplicationBuilder UseKeePortCsrf(this IApplicationBuilder app, SessionService sessions)
    {
        return app.Use(async (context, next) =>
        {
            var method = context.Request.Method;
            var isMutation = HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
            var path = context.Request.Path.Value ?? string.Empty;
            if (isMutation && path.StartsWith("/api", StringComparison.OrdinalIgnoreCase) &&
                context.Items[SessionService.SessionItemKey] is SessionRecord session &&
                !IsCsrfExempt(path))
            {
                var headerToken = context.Request.Headers["X-CSRF-Token"].ToString();
                if (!sessions.ValidateCsrfToken(session, headerToken))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsJsonAsync(new ErrorResponse("csrf_failed", "Missing or invalid CSRF token."));
                    return;
                }
            }

            await next();
        });
    }

    private static bool IsCsrfExempt(string path)
    {
        return path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase) ||
               path.Equals("/api/auth/setup", StringComparison.OrdinalIgnoreCase);
    }
}
