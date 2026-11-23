using System.Globalization;
using System.Text;
using KeePort.Api.Data;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

/// <summary>Pairs a verified WebDAV credential with its owning user.</summary>
/// <param name="Credential">The verified credential used for WebDAV authentication.</param>
/// <param name="User">The user account that owns the verified credential.</param>
public sealed record WebDavAuthResult(WebDavCredentialRecord Credential, UserRecord User);

public static class WebDavEndpoints
{
    private const string AuthItemKey = "KeePort.WebDavAuth";
    private static readonly string[] Methods = ["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "LOCK", "UNLOCK"];

    /// <summary>Adds authentication for WebDAV requests before they reach the vault handlers.</summary>
    /// <param name="app">The application pipeline to which the middleware is added.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="hasher">The service for hashing and verifying passwords.</param>
    public static IApplicationBuilder UseWebDavAuthentication(this IApplicationBuilder app, KeePortDb db, PasswordHasher hasher)
    {
       // Authenticates WebDAV requests and challenges unauthenticated clients when required.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="next">The next middleware in the request pipeline.</param>
        return app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? string.Empty;
            if (!path.Equals("/webdav", StringComparison.OrdinalIgnoreCase) &&
                !path.StartsWith("/webdav/", StringComparison.OrdinalIgnoreCase))
            {
                await next();
                return;
            }

            var auth = Authenticate(context, db, hasher);
            if (auth is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.Headers.WWWAuthenticate = "Basic realm=\"KeePort WebDAV\", charset=\"UTF-8\"";
                return;
            }

            context.Items[AuthItemKey] = auth;
            await next();
        });
    }

    /// <summary>Maps supported WebDAV methods on the root and child paths.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapWebDavEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapMethods("/webdav", Methods, HandleAsync);
        app.MapMethods("/webdav/{**path}", Methods, HandleAsync);
    }

    /// <summary>Routes a WebDAV request to the appropriate collection or vault operation.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> HandleAsync(HttpContext context, VaultService vault, KeePortDb db, CancellationToken cancellationToken)
    {
        if (context.Items[AuthItemKey] is not WebDavAuthResult auth)
        {
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        var relativePath = GetRelativePath(context.Request.Path.Value ?? string.Empty);
        if (relativePath.Contains('/', StringComparison.Ordinal) || relativePath.Contains('\\', StringComparison.Ordinal))
        {
            return Results.NotFound(new ErrorResponse("not_found", "Only flat vault file names are supported."));
        }

        var method = context.Request.Method.ToUpperInvariant();
        var isCollection = relativePath.Length == 0;
        var file = isCollection ? null : vault.GetByName(relativePath);
        if (!isCollection && file is null)
        {
            return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
        }

        return method switch
        {
            "OPTIONS" => HandleOptions(context),
            "PROPFIND" => HandlePropFind(context, vault, auth.User, isCollection, file),
            "GET" => isCollection ? MethodNotAllowed(context, "PROPFIND") : HandleGet(context, vault, auth.User, file!, includeBody: true, cancellationToken),
            "HEAD" => isCollection ? MethodNotAllowed(context, "PROPFIND") : HandleGet(context, vault, auth.User, file!, includeBody: false, cancellationToken),
            "PUT" => isCollection ? MethodNotAllowed(context, "GET, HEAD, PROPFIND") : await HandlePutAsync(context, vault, auth.User, file!, cancellationToken),
            "DELETE" => Results.Text("Deleting .kdbx files via WebDAV is disabled. Use the admin UI.", statusCode: StatusCodes.Status403Forbidden),
            "LOCK" => HandleLock(context),
            "UNLOCK" => Results.StatusCode(StatusCodes.Status204NoContent),
            _ => MethodNotAllowed(context, "OPTIONS, PROPFIND, GET, HEAD, PUT, LOCK, UNLOCK")
        };
    }

    /// <summary>Removes the WebDAV path prefix and decodes the remaining path.</summary>
    /// <param name="path">The incoming WebDAV request path, including the WebDAV prefix.</param>
    private static string GetRelativePath(string path)
    {
        const string prefix = "/webdav";
        if (path.Length <= prefix.Length)
        {
            return string.Empty;
        }
        var relative = path[prefix.Length..];
        if (relative.StartsWith('/'))
        {
            relative = relative[1..];
        }
        if (relative.EndsWith('/'))
        {
            relative = relative[..^1];
        }
        return relative;
    }

    /// <summary>Advertises the methods and DAV capabilities supported by this endpoint.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    private static IResult HandleOptions(HttpContext context)
    {
        context.Response.Headers.Allow = "OPTIONS, PROPFIND, GET, HEAD, PUT, LOCK, UNLOCK";
        context.Response.Headers["DAV"] = "1, 2";
        context.Response.Headers["MS-Author-Via"] = "DAV";
        context.Response.ContentLength = 0;
        return Results.StatusCode(StatusCodes.Status200OK);
    }

    /// <summary>Returns HTTP 405 with the methods allowed on the target resource.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="allow">The comma-separated HTTP methods to include in the Allow header.</param>
    private static IResult MethodNotAllowed(HttpContext context, string allow)
    {
        context.Response.Headers.Allow = allow;
        return Results.StatusCode(StatusCodes.Status405MethodNotAllowed);
    }

    /// <summary>Returns vault bytes or headers only after checking read access and conditional requests.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="user">The user account associated with the operation.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    /// <param name="includeBody">Whether to send the encrypted response body; false for HEAD.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static IResult HandleGet(HttpContext context, VaultService vault, UserRecord user, VaultFileRecord file, bool includeBody, CancellationToken cancellationToken)
    {
        if (!vault.CanRead(user, file))
        {
            return Results.Json(new ErrorResponse("forbidden", "You do not have read access to this vault."), statusCode: StatusCodes.Status403Forbidden);
        }

        var path = vault.GetContentPath(file);
        if (!File.Exists(path))
        {
            return Results.NotFound(new ErrorResponse("content_missing", "Vault content is missing on the server."));
        }

        context.Response.Headers.ETag = file.ETag;
        context.Response.Headers["Last-Modified"] = file.UpdatedAt.UtcDateTime.ToString("R", CultureInfo.InvariantCulture);
        context.Response.Headers["X-KeePort-Revision"] = file.Revision.ToString(CultureInfo.InvariantCulture);
        if (!includeBody)
        {
            context.Response.ContentLength = file.Size;
            context.Response.ContentType = "application/octet-stream";
            return Results.StatusCode(StatusCodes.Status200OK);
        }

        return Results.File(path, "application/octet-stream", file.Name, enableRangeProcessing: false);
    }

    /// <summary>Checks write access and conditional headers before accepting a WebDAV upload.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="user">The user account associated with the operation.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> HandlePutAsync(HttpContext context, VaultService vault, UserRecord user, VaultFileRecord file, CancellationToken cancellationToken)
    {
        if (file.DeletedAt is not null)
        {
            return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
        }
        if (!vault.CanWrite(user, file))
        {
            return Results.Json(new ErrorResponse("forbidden", "You do not have write access to this vault."), statusCode: StatusCodes.Status403Forbidden);
        }

        var expectedETag = context.Request.Headers["X-KeePort-Expected-ETag"].FirstOrDefault()
            ?? context.Request.Headers.IfMatch.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(expectedETag))
        {
            return Results.Json(new ErrorResponse("precondition_required", "WebDAV writes require If-Match with the current ETag."), statusCode: StatusCodes.Status428PreconditionRequired);
        }

        byte[] content;
        await using (var memory = new MemoryStream())
        {
            await context.Request.Body.CopyToAsync(memory, cancellationToken);
            content = memory.ToArray();
        }

        VaultWriteResult result;
        try
        {
            result = await vault.WriteContentAsync(file.Id, content, expectedETag, user, "webdav", cancellationToken);
        }
        catch (VaultValidationException ex)
        {
            return Results.Json(new ErrorResponse("invalid_vault", ex.Message), statusCode: StatusCodes.Status400BadRequest);
        }

        return result.Status switch
        {
            VaultWriteStatus.Success => SuccessPut(context, result.File!),
            VaultWriteStatus.PreconditionRequired => Results.Json(
                new ErrorResponse("precondition_required", "Expected ETag is required.", result.CurrentETag),
                statusCode: StatusCodes.Status428PreconditionRequired),
            VaultWriteStatus.NotFound => Results.NotFound(new ErrorResponse("not_found", "Vault file not found.")),
            VaultWriteStatus.Forbidden => Results.Json(new ErrorResponse("forbidden", "You do not have write access to this vault."), statusCode: StatusCodes.Status403Forbidden),
            VaultWriteStatus.Conflict => ConflictPut(context, result.CurrentETag),
            _ => throw new InvalidOperationException("Unexpected vault write status.")
        };
    }

    /// <summary>Returns a successful WebDAV update status with the new ETag.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    private static IResult SuccessPut(HttpContext context, VaultFileRecord file)
    {
        context.Response.Headers.ETag = file.ETag;
        context.Response.Headers["X-KeePort-Revision"] = file.Revision.ToString(CultureInfo.InvariantCulture);
        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>Returns the WebDAV precondition failure with the current ETag when available.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="currentETag">The current file entity tag, if known.</param>
    private static IResult ConflictPut(HttpContext context, string? currentETag)
    {
        if (!string.IsNullOrEmpty(currentETag))
        {
            context.Response.Headers.ETag = currentETag;
        }
        return Results.Json(
            new ErrorResponse("conflict", VaultService.ConflictCopyMessage, currentETag),
            statusCode: StatusCodes.Status412PreconditionFailed);
    }

    /// <summary>Returns a compatibility lock token without taking a server-side lock.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    private static IResult HandleLock(HttpContext context)
    {
        var token = $"opaquelocktoken:{Guid.NewGuid():N}";
        context.Response.Headers["Lock-Token"] = $"<{token}>";
        context.Response.ContentLength = 0;
        return Results.StatusCode(StatusCodes.Status200OK);
    }

    /// <summary>Builds the WebDAV multistatus response for a vault or collection listing.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="user">The user account associated with the operation.</param>
    /// <param name="isCollection">Whether the target is the WebDAV root collection rather than a vault file.</param>
    /// <param name="file">The file metadata, or null for a collection response.</param>
    private static IResult HandlePropFind(HttpContext context, VaultService vault, UserRecord user, bool isCollection, VaultFileRecord? file)
    {
        var depth = context.Request.Headers["Depth"].ToString();
        var includeChildren = isCollection && !string.Equals(depth, "0", StringComparison.OrdinalIgnoreCase);
        if (!isCollection && file is not null && !vault.CanRead(user, file))
        {
            return Results.Json(new ErrorResponse("forbidden", "You do not have read access to this vault."), statusCode: StatusCodes.Status403Forbidden);
        }
        var files = isCollection
            ? vault.ListForUser(user).Where(/* Includes only vaults the authenticated user can read.
             * <param name="f">A vault file whose read permission must be checked.</param>
             */ f => vault.CanRead(user, f)).ToArray()
            : file is null ? Array.Empty<VaultFileRecord>() : [file];

        var xml = new StringBuilder();
        xml.Append("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
        xml.Append("<D:multistatus xmlns:D=\"DAV:\">");

        if (isCollection)
        {
            AppendResponse(xml, "/webdav/", "webdav", true, null, DateTimeOffset.UtcNow);
            if (includeChildren)
            {
                foreach (var child in files)
                {
                    AppendResponse(xml, $"/webdav/{Uri.EscapeDataString(child.Name)}", child.Name, false, child, child.UpdatedAt);
                }
            }
        }
        else if (file is not null)
        {
            AppendResponse(xml, $"/webdav/{Uri.EscapeDataString(file.Name)}", file.Name, false, file, file.UpdatedAt);
        }

        xml.Append("</D:multistatus>");
        return new WebDavXmlResult(xml.ToString());
    }

    /// <summary>Appends one resource and its DAV properties to the multistatus document.</summary>
    /// <param name="xml">The accumulating multistatus document to which to append the resource.</param>
    /// <param name="href">The resource URL to include in the DAV response.</param>
    /// <param name="displayName">The human-readable name of the DAV resource.</param>
    /// <param name="isCollection">Whether the target is the WebDAV root collection rather than a vault file.</param>
    /// <param name="file">The file metadata, or null for a collection response.</param>
    /// <param name="lastModified">The modification time to advertise for this resource.</param>
    private static void AppendResponse(StringBuilder xml, string href, string displayName, bool isCollection, VaultFileRecord? file, DateTimeOffset lastModified)
    {
        xml.Append("<D:response>");
        xml.Append($"<D:href>{XmlEscape(href)}</D:href>");
        xml.Append("<D:propstat><D:prop>");
        xml.Append($"<D:displayname>{XmlEscape(displayName)}</D:displayname>");
        xml.Append(isCollection ? "<D:resourcetype><D:collection/></D:resourcetype>" : "<D:resourcetype/>");
        xml.Append($"<D:getlastmodified>{lastModified.UtcDateTime.ToString("R", CultureInfo.InvariantCulture)}</D:getlastmodified>");
        if (file is not null)
        {
            xml.Append($"<D:getetag>{XmlEscape(file.ETag)}</D:getetag>");
            xml.Append($"<D:getcontentlength>{file.Size}</D:getcontentlength>");
            xml.Append("<D:getcontenttype>application/octet-stream</D:getcontenttype>");
        }
        xml.Append("</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>");
        xml.Append("</D:response>");
    }

    /// <summary>Escapes characters that would otherwise be interpreted as XML markup.</summary>
    /// <param name="value">The text to escape for insertion into a DAV XML document.</param>
    private static string XmlEscape(string value)
    {
        return value
            .Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal)
            .Replace("\"", "&quot;", StringComparison.Ordinal)
            .Replace("'", "&apos;", StringComparison.Ordinal);
    }

    /// <summary>Verifies a WebDAV Basic credential and rejects revoked credentials or ineligible owners.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="hasher">The service for hashing and verifying passwords.</param>
    private static WebDavAuthResult? Authenticate(HttpContext context, KeePortDb db, PasswordHasher hasher)
    {
        var header = context.Request.Headers.Authorization.ToString();
        const string prefix = "Basic ";
        if (!header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        string decoded;
        try
        {
            decoded = Encoding.UTF8.GetString(Convert.FromBase64String(header[prefix.Length..].Trim()));
        }
        catch (FormatException)
        {
            return null;
        }

        var separator = decoded.IndexOf(':', StringComparison.Ordinal);
        if (separator <= 0)
        {
            return null;
        }

        var username = decoded[..separator];
        var password = decoded[(separator + 1)..];
        var credential = db.GetWebDavCredentialByUsername(username);
        if (credential?.User is null || credential.User.Role != UserRole.User || credential.RevokedAt is not null || credential.User.Disabled)
        {
            return null;
        }
        if (!hasher.Verify(password, credential.PasswordHash))
        {
            return null;
        }

        if (credential.LastUsedAt is null || DateTimeOffset.UtcNow - credential.LastUsedAt.Value > TimeSpan.FromMinutes(1))
        {
            db.UpdateWebDavCredentialLastUsed(credential.Id, DateTimeOffset.UtcNow);
        }

        return new WebDavAuthResult(credential, credential.User);
    }

    /// <summary>Wraps a WebDAV multistatus XML document as an HTTP result.</summary>
    /// <param name="xml">The XML document to send in the multistatus response.</param>
    private sealed class WebDavXmlResult(string xml) : IResult
    {
        /// <summary>Writes the XML response using the WebDAV multistatus status code.</summary>
        /// <param name="context">The current HTTP request and response context.</param>
        public async Task ExecuteAsync(HttpContext context)
        {
            context.Response.StatusCode = StatusCodes.Status207MultiStatus;
            context.Response.ContentType = "application/xml; charset=utf-8";
            await context.Response.WriteAsync(xml);
        }
    }
}
