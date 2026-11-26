using System.Text;
using KeePort.Api.Data;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace KeePort.Api.Security;

public static class ApiAuth
{
    /// <summary>Gets the authenticated user attached to the current request, if present.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    public static UserRecord? GetUser(HttpContext context) => context.Items[SessionService.UserItemKey] as UserRecord;

    /// <summary>Gets the validated session attached to the current request, if present.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    public static SessionRecord? GetSession(HttpContext context) => context.Items[SessionService.SessionItemKey] as SessionRecord;

    /// <summary>Returns an unauthorized result unless the current request has a signed-in user.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    public static IResult? RequireAuthenticated(HttpContext context)
    {
        return GetUser(context) is null ? Results.Unauthorized() : null;
    }

    /// <summary>Returns an authorization error unless the signed-in user is an administrator.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
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
    /// <summary>Adds session authentication middleware for the KeePort API routes.</summary>
    /// <param name="app">The application pipeline to which the middleware is added.</param>
    /// <param name="sessions">The service for managing sessions, cookies, and CSRF tokens.</param>
    /// <param name="secureCookies">Whether to set the Secure flag on session cookies.</param>
    public static IApplicationBuilder UseKeePortSession(this IApplicationBuilder app, SessionService sessions, bool secureCookies)
    {
       // Selects the role-specific cookie and attaches the validated session to the request.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="next">The next middleware in the request pipeline.</param>
        return app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            if (!path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
            {
                await next();
                return;
            }

            var role = path.StartsWithSegments(SessionService.AdminApiPath, StringComparison.OrdinalIgnoreCase)
                ? UserRole.Admin : UserRole.User;
            var token = context.Request.Cookies[SessionService.GetCookieName(role)];
            if (string.IsNullOrEmpty(token))
            {
                await next();
                return;
            }

            var session = sessions.ValidateSessionToken(token, role);
            if (session?.User is null)
            {
                sessions.ClearSessionCookie(context, role, secureCookies);
                await next();
                return;
            }

            context.User = SessionService.CreatePrincipal(session.User);
            context.Items[SessionService.SessionItemKey] = session;
            context.Items[SessionService.UserItemKey] = session.User;
            await next();
        });
    }

    /// <summary>Adds CSRF enforcement for API requests that change state.</summary>
    /// <param name="app">The application pipeline to which the middleware is added.</param>
    /// <param name="sessions">The service for managing sessions, cookies, and CSRF tokens.</param>
    public static IApplicationBuilder UseKeePortCsrf(this IApplicationBuilder app, SessionService sessions)
    {
       // Rejects non-exempt API mutations unless they carry a valid session CSRF token.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="next">The next middleware in the request pipeline.</param>
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

    /// <summary>Identifies the setup, login and password-link routes that can run without a CSRF token.</summary>
    /// <param name="path">The API request path to check against the exemption list.</param>
    private static bool IsCsrfExempt(string path)
    {
        return path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase) ||
               path.Equals("/api/auth/password-reset", StringComparison.OrdinalIgnoreCase) ||
               path.Equals("/api/auth/token", StringComparison.OrdinalIgnoreCase) ||
               path.Equals("/api/auth/set-password", StringComparison.OrdinalIgnoreCase) ||
               path.Equals(SessionService.AdminApiPath + "/auth/login", StringComparison.OrdinalIgnoreCase) ||
               path.Equals(SessionService.AdminApiPath + "/auth/setup", StringComparison.OrdinalIgnoreCase);
    }
}
