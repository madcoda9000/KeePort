using System.Diagnostics;
using System.Globalization;
using System.Text;
using KeePort.Api.Data;
using KeePort.Api.Security;
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
    private const string AllowedMethods = "OPTIONS, PROPFIND, GET, HEAD, PUT, MOVE, LOCK, UNLOCK";
    private static readonly string[] Methods = ["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MOVE", "LOCK", "UNLOCK"];

    /// <summary>Adds authentication for WebDAV requests before they reach the vault handlers.</summary>
    /// <param name="app">The application pipeline to which the middleware is added.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="hasher">The service for hashing and verifying passwords.</param>
    public static IApplicationBuilder UseWebDavAuthentication(this IApplicationBuilder app, KeePortDb db, PasswordHasher hasher)
    {
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>().CreateLogger("KeePort.WebDav");

       // Authenticates WebDAV requests, challenges unauthenticated clients, and logs each request without credentials.
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

            var started = Stopwatch.GetTimestamp();
            var auth = Authenticate(context, db, hasher);
            if (auth is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.Headers.WWWAuthenticate = "Basic realm=\"KeePort WebDAV\", charset=\"UTF-8\"";
                LogRequest(logger, db, context, null, started);
                return;
            }

            context.Items[AuthItemKey] = auth;
            try
            {
                await next();
            }
            finally
            {
                LogRequest(logger, db, context, auth, started);
            }
        });
    }

    /// <summary>
    /// Logs method, path, status and the relevant precondition headers of a WebDAV request to the console and the
    /// admin-visible request log, never credentials or content. Storage failures never affect the request.
    /// </summary>
    /// <param name="logger">The logger that receives the request line.</param>
    /// <param name="db">The SQLite store that keeps the admin-visible request log.</param>
    /// <param name="context">The completed HTTP request and response context.</param>
    /// <param name="auth">The verified credential, or null if authentication failed.</param>
    /// <param name="started">The <see cref="Stopwatch"/> timestamp taken when the request entered the middleware.</param>
    private static void LogRequest(ILogger logger, KeePortDb db, HttpContext context, WebDavAuthResult? auth, long started)
    {
        var request = context.Request;
        var entry = new WebDavRequestLogDto(
            0,
            DateTimeOffset.UtcNow,
            request.Method,
            request.Path.Value ?? string.Empty,
            context.Response.StatusCode,
            auth?.Credential.Username,
            ClientIp.Format(context.Connection.RemoteIpAddress),
            (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds,
            request.ContentLength,
            request.Headers.IfMatch.Count > 0,
            NullIfEmpty(request.Headers["Depth"].ToString()),
            NullIfEmpty(request.Headers["Destination"].ToString()),
            NullIfEmpty(request.Headers["Overwrite"].ToString()));

        logger.LogInformation(
            "WebDAV {Method} {Path} -> {Status} (credential: {Credential}, If-Match: {IfMatch}, Depth: {Depth}, Destination: {Destination}, Overwrite: {Overwrite}, Length: {Length}, {DurationMs} ms)",
            LogText.Clean(entry.Method),
            LogText.Clean(entry.Path),
            entry.Status,
            LogText.Clean(entry.Credential) ?? "-",
            entry.IfMatch ? "yes" : "no",
            LogText.Clean(entry.Depth) ?? "-",
            LogText.Clean(entry.Destination) ?? "-",
            LogText.Clean(entry.Overwrite) ?? "-",
            entry.ContentLength?.ToString(CultureInfo.InvariantCulture) ?? "-",
            entry.DurationMs);

        try
        {
            db.AddWebDavRequestLog(entry);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not store the WebDAV request log entry.");
        }
    }

    /// <summary>Returns null for an empty header value so the log stores a missing value instead of an empty string.</summary>
    /// <param name="value">The header value to check.</param>
    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;

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
    /// <param name="staging">The store for temporary uploads that are later moved onto a vault.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> HandleAsync(HttpContext context, VaultService vault, KeePortDb db, WebDavStagingStore staging, CancellationToken cancellationToken)
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
            if (WebDavStagingStore.TryParseStagingName(relativePath, out var targetName) && vault.GetByName(targetName) is { } target)
            {
                return await HandleStagingAsync(context, vault, db, staging, auth, method, relativePath, target, cancellationToken);
            }
            return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
        }

        return method switch
        {
            "OPTIONS" => HandleOptions(context),
            "PROPFIND" => HandlePropFind(context, vault, auth.User, isCollection, file),
            "GET" => isCollection ? MethodNotAllowed(context, "PROPFIND") : HandleGet(context, vault, db, auth, file!, includeBody: true),
            "HEAD" => isCollection ? MethodNotAllowed(context, "PROPFIND") : HandleGet(context, vault, db, auth, file!, includeBody: false),
            "PUT" => isCollection ? MethodNotAllowed(context, "GET, HEAD, PROPFIND") : await HandlePutAsync(context, vault, db, auth, file!, cancellationToken),
            "DELETE" => Results.Text("Deleting .kdbx files via WebDAV is disabled. Use the admin UI.", statusCode: StatusCodes.Status403Forbidden),
            "MOVE" => Results.Text("Renaming .kdbx files via WebDAV is disabled. Use the admin UI.", statusCode: StatusCodes.Status403Forbidden),
            "LOCK" => HandleLock(context),
            "UNLOCK" => Results.StatusCode(StatusCodes.Status204NoContent),
            _ => MethodNotAllowed(context, AllowedMethods)
        };
    }

    /// <summary>Handles requests on a temporary upload name that belongs to an existing vault.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="staging">The store for temporary uploads that are later moved onto a vault.</param>
    /// <param name="auth">The verified WebDAV credential and its owner.</param>
    /// <param name="method">The upper-case HTTP method of the request.</param>
    /// <param name="stagingName">The temporary file name from the request path.</param>
    /// <param name="target">The vault that the temporary upload belongs to.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> HandleStagingAsync(
        HttpContext context,
        VaultService vault,
        KeePortDb db,
        WebDavStagingStore staging,
        WebDavAuthResult auth,
        string method,
        string stagingName,
        VaultFileRecord target,
        CancellationToken cancellationToken)
    {
        if (!vault.CanWrite(auth.User, target))
        {
            return vault.CanRead(auth.User, target)
                ? Results.Json(new ErrorResponse("forbidden", "You do not have write access to this vault."), statusCode: StatusCodes.Status403Forbidden)
                : Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
        }

        switch (method)
        {
            case "PUT":
            {
                var content = await ReadBodyAsync(context, cancellationToken);
                if (!VaultService.HasKdbxSignature(content))
                {
                    return Results.Json(new ErrorResponse("invalid_vault", "File does not have a valid KDBX signature."), statusCode: StatusCodes.Status400BadRequest);
                }
                await staging.SaveAsync(auth.Credential.Id, stagingName, content, cancellationToken);
                return Results.StatusCode(StatusCodes.Status201Created);
            }
            case "MOVE":
                return await HandleStagingMoveAsync(context, vault, db, staging, auth, stagingName, target, cancellationToken);
            case "DELETE":
                return staging.Delete(auth.Credential.Id, stagingName)
                    ? Results.StatusCode(StatusCodes.Status204NoContent)
                    : Results.NotFound(new ErrorResponse("not_found", "Temporary upload not found."));
            case "OPTIONS":
                return HandleOptions(context);
            default:
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
        }
    }

    /// <summary>Moves a temporary upload onto its vault using the regular conflict-checked write path.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="staging">The store for temporary uploads that are later moved onto a vault.</param>
    /// <param name="auth">The verified WebDAV credential and its owner.</param>
    /// <param name="stagingName">The temporary file name from the request path.</param>
    /// <param name="target">The vault that the temporary upload belongs to.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> HandleStagingMoveAsync(
        HttpContext context,
        VaultService vault,
        KeePortDb db,
        WebDavStagingStore staging,
        WebDavAuthResult auth,
        string stagingName,
        VaultFileRecord target,
        CancellationToken cancellationToken)
    {
        var destination = GetDestinationName(context);
        if (destination is null)
        {
            return Results.Json(new ErrorResponse("bad_request", "MOVE requires a Destination header below /webdav/."), statusCode: StatusCodes.Status400BadRequest);
        }
        if (!string.Equals(destination, target.Name, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Json(new ErrorResponse("forbidden", "A temporary upload can only be moved onto its own vault."), statusCode: StatusCodes.Status403Forbidden);
        }
        if (string.Equals(context.Request.Headers["Overwrite"].ToString().Trim(), "F", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Json(new ErrorResponse("precondition_failed", "The destination vault exists and Overwrite is F."), statusCode: StatusCodes.Status412PreconditionFailed);
        }

        var content = await staging.ReadAsync(auth.Credential.Id, stagingName, cancellationToken);
        if (content is null)
        {
            return Results.NotFound(new ErrorResponse("not_found", "Temporary upload not found."));
        }

        try
        {
            return await WriteVaultAsync(context, vault, db, auth, target, content, cancellationToken);
        }
        finally
        {
            staging.Delete(auth.Credential.Id, stagingName);
        }
    }

    /// <summary>Resolves the flat vault name from a MOVE request's Destination header, or null if it is not below /webdav/.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    private static string? GetDestinationName(HttpContext context)
    {
        var header = context.Request.Headers["Destination"].ToString().Trim();
        if (header.Length == 0)
        {
            return null;
        }

        string path;
        if (Uri.TryCreate(header, UriKind.Absolute, out var absolute) && (absolute.Scheme == Uri.UriSchemeHttp || absolute.Scheme == Uri.UriSchemeHttps))
        {
            path = absolute.AbsolutePath;
        }
        else if (header.StartsWith('/'))
        {
            path = header.Split('?', '#')[0];
        }
        else
        {
            return null;
        }

        // A reverse proxy may publish WebDAV below a prefix (e.g. /keeport/webdav/), so only the part from /webdav/ on counts.
        path = Uri.UnescapeDataString(path);
        var webDavIndex = path.IndexOf("/webdav/", StringComparison.OrdinalIgnoreCase);
        if (webDavIndex < 0)
        {
            return null;
        }

        var name = GetRelativePath(path[webDavIndex..]);
        return name.Length == 0 || name.Contains('/', StringComparison.Ordinal) || name.Contains('\\', StringComparison.Ordinal) ? null : name;
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
        context.Response.Headers.Allow = AllowedMethods;
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

    /// <summary>Returns vault bytes or headers after checking read access, and remembers which version a GET delivered.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="auth">The verified WebDAV credential and its owner.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    /// <param name="includeBody">Whether to send the encrypted response body; false for HEAD.</param>
    private static IResult HandleGet(HttpContext context, VaultService vault, KeePortDb db, WebDavAuthResult auth, VaultFileRecord file, bool includeBody)
    {
        if (!vault.CanRead(auth.User, file))
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

        // A full download means this client now holds this version; writes without If-Match are checked against it.
        db.SetWebDavReadETag(auth.Credential.Id, file.Id, file.ETag);
        return Results.File(path, "application/octet-stream", file.Name, enableRangeProcessing: false);
    }

    /// <summary>Checks write access before accepting a direct WebDAV upload onto a vault.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="auth">The verified WebDAV credential and its owner.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> HandlePutAsync(HttpContext context, VaultService vault, KeePortDb db, WebDavAuthResult auth, VaultFileRecord file, CancellationToken cancellationToken)
    {
        if (file.DeletedAt is not null)
        {
            return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
        }
        if (!vault.CanWrite(auth.User, file))
        {
            return Results.Json(new ErrorResponse("forbidden", "You do not have write access to this vault."), statusCode: StatusCodes.Status403Forbidden);
        }

        var content = await ReadBodyAsync(context, cancellationToken);
        return await WriteVaultAsync(context, vault, db, auth, file, content, cancellationToken);
    }

    /// <summary>Reads the complete request body into memory.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<byte[]> ReadBodyAsync(HttpContext context, CancellationToken cancellationToken)
    {
        await using var memory = new MemoryStream();
        await context.Request.Body.CopyToAsync(memory, cancellationToken);
        return memory.ToArray();
    }

    /// <summary>
    /// Writes new vault content with an ETag precondition. Without If-Match, the version this credential last
    /// downloaded is the expected one, so stale saves still become conflict copies instead of overwriting.
    /// </summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
    /// <param name="db">The SQLite store for KeePort metadata.</param>
    /// <param name="auth">The verified WebDAV credential and its owner.</param>
    /// <param name="file">The vault to write.</param>
    /// <param name="content">The encrypted KDBX bytes submitted by the client.</param>
    /// <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
    private static async Task<IResult> WriteVaultAsync(HttpContext context, VaultService vault, KeePortDb db, WebDavAuthResult auth, VaultFileRecord file, byte[] content, CancellationToken cancellationToken)
    {
        var expectedETag = context.Request.Headers["X-KeePort-Expected-ETag"].FirstOrDefault()
            ?? context.Request.Headers.IfMatch.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(expectedETag))
        {
            expectedETag = db.GetWebDavReadETag(auth.Credential.Id, file.Id);
        }
        if (string.IsNullOrWhiteSpace(expectedETag))
        {
            return Results.Json(
                new ErrorResponse("precondition_required", "WebDAV writes require If-Match with the current ETag or a prior download with this credential."),
                statusCode: StatusCodes.Status428PreconditionRequired);
        }

        VaultWriteResult result;
        try
        {
            result = await vault.WriteContentAsync(file.Id, content, expectedETag, auth.User, "webdav", cancellationToken, $"WebDAV · {auth.Credential.Label}");
        }
        catch (VaultValidationException ex)
        {
            return Results.Json(new ErrorResponse("invalid_vault", ex.Message), statusCode: StatusCodes.Status400BadRequest);
        }
        catch (VaultVersionException ex)
        {
            return VaultEndpoints.VersionFailed(context, ex);
        }

        if (result.Status == VaultWriteStatus.Success)
        {
            db.SetWebDavReadETag(auth.Credential.Id, file.Id, result.File!.ETag);
        }
        VaultEndpoints.RecordSave(context, result, file, auth.User, $"WebDAV · {auth.Credential.Label}");

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
