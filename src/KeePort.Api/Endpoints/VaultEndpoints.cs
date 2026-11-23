using System.Globalization;
using KeePort.Api.Data;
using KeePort.Api.Security;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace KeePort.Api.Endpoints;

public static class VaultEndpoints
{
    /// <summary>Registers vault listing, content download, and content update endpoints.</summary>
    /// <param name="app">The endpoint route builder on which to register the routes.</param>
    public static void MapVaultEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/vault");

        // Lists the active vaults the signed-in user can access.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapGet("/files", (HttpContext context, VaultService vault) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            return Results.Ok(vault.ListForUser(user).Select(ToDto).ToArray());
        });

        // Checks read permission before serving the encrypted vault with its current ETag.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        group.MapGet("/files/{id}/content", (string id, HttpContext context, VaultService vault) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var file = vault.Get(id);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
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
            return Results.File(path, "application/octet-stream", file.Name, enableRangeProcessing: false);
        });

        // Checks write access and the ETag precondition before accepting encrypted vault content.
        // <param name="id">The vault file ID.</param>
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="vault">The service for checking vault access and reading or writing encrypted files.</param>
        // <param name="cancellationToken">A token that cancels the operation when the caller no longer needs it.</param>
        group.MapPut("/files/{id}/content", async (string id, HttpContext context, VaultService vault, CancellationToken cancellationToken) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            var file = vault.Get(id);
            if (file is null)
            {
                return Results.NotFound(new ErrorResponse("not_found", "Vault file not found."));
            }
            if (!vault.CanWrite(user, file))
            {
                return Results.Json(new ErrorResponse("forbidden", "You do not have write access to this vault."), statusCode: StatusCodes.Status403Forbidden);
            }

            var expectedETag = context.Request.Headers["X-Expected-ETag"].FirstOrDefault()
                ?? context.Request.Headers.IfMatch.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(expectedETag))
            {
                return Results.Json(new ErrorResponse("precondition_required", "Send If-Match or X-Expected-ETag with the current ETag."), statusCode: StatusCodes.Status428PreconditionRequired);
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
                result = await vault.WriteContentAsync(file.Id, content, expectedETag, user, "rest", cancellationToken);
            }
            catch (VaultValidationException ex)
            {
                return Results.Json(new ErrorResponse("invalid_vault", ex.Message), statusCode: StatusCodes.Status400BadRequest);
            }

            return result.Status switch
            {
                VaultWriteStatus.Success => SuccessResult(context, result.File!),
                VaultWriteStatus.PreconditionRequired => Results.Json(
                    new ErrorResponse("precondition_required", "Expected ETag is required.", result.CurrentETag),
                    statusCode: StatusCodes.Status428PreconditionRequired),
                VaultWriteStatus.NotFound => Results.NotFound(new ErrorResponse("not_found", "Vault file not found.")),
                VaultWriteStatus.Forbidden => Results.Json(new ErrorResponse("forbidden", "You do not have write access to this vault."), statusCode: StatusCodes.Status403Forbidden),
                VaultWriteStatus.Conflict => Results.Json(
                    new ErrorResponse("conflict", VaultService.ConflictCopyMessage, result.CurrentETag),
                    statusCode: StatusCodes.Status409Conflict),
                _ => throw new InvalidOperationException("Unexpected vault write status.")
            };
        });
    }

    /// <summary>Returns the saved file metadata with the matching ETag header.</summary>
    /// <param name="context">The current HTTP request and response context.</param>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    private static IResult SuccessResult(HttpContext context, VaultFileRecord file)
    {
        context.Response.Headers.ETag = file.ETag;
        context.Response.Headers["X-KeePort-Revision"] = file.Revision.ToString(CultureInfo.InvariantCulture);
        return Results.Ok(ToDto(file));
    }

    /// <summary>Converts a vault record into the metadata returned by the Vault API.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    internal static VaultFileDto ToDto(VaultFileRecord file)
    {
        return new VaultFileDto(file.Id, file.Name, file.Size, file.Revision, file.ETag, file.CreatedAt, file.UpdatedAt, file.Permission, file.DeletedAt);
    }
}
