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
    public static void MapVaultEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/vault");

        group.MapGet("/files", (HttpContext context, VaultService vault) =>
        {
            if (ApiAuth.RequireAuthenticated(context) is { } unauthorized)
            {
                return unauthorized;
            }
            var user = ApiAuth.GetUser(context)!;
            return Results.Ok(vault.ListForUser(user).Select(ToDto).ToArray());
        });

        group.MapGet("/files/{id}/content", async (string id, HttpContext context, VaultService vault, CancellationToken cancellationToken) =>
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
                result = await vault.WriteContentAsync(file, content, expectedETag, user, cancellationToken);
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
                _ => Results.Json(
                    new ErrorResponse("conflict", "The vault changed on the server. Reload and retry.", result.CurrentETag),
                    statusCode: StatusCodes.Status409Conflict)
            };
        });
    }

    private static IResult SuccessResult(HttpContext context, VaultFileRecord file)
    {
        context.Response.Headers.ETag = file.ETag;
        context.Response.Headers["X-KeePort-Revision"] = file.Revision.ToString(CultureInfo.InvariantCulture);
        return Results.Ok(ToDto(file));
    }

    internal static VaultFileDto ToDto(VaultFileRecord file)
    {
        return new VaultFileDto(file.Id, file.Name, file.Size, file.Revision, file.ETag, file.CreatedAt, file.UpdatedAt, file.Permission, file.DeletedAt);
    }
}
