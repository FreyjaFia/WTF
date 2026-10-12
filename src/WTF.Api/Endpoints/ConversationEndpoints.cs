using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Conversations;
using WTF.Api.Services;

namespace WTF.Api.Endpoints;

/// <summary>Chat for staff. Reading is for everyone who can read orders; replying and marking read need write access.</summary>
public static class ConversationEndpoints
{
    public static IEndpointRouteBuilder MapConversations(this IEndpointRouteBuilder app)
    {
        // GET /api/conversations - The envelope list: conversations with unread customer messages first, newest first
        app.MapGet("/api/conversations",
            async (ISender sender) => Results.Ok(await sender.Send(new GetConversationsQuery())))
            .RequireAuthorization(AppPolicies.OrdersRead);

        // GET /api/orders/{id}/conversation - The chat of one customer link order
        app.MapGet("/api/orders/{id:guid}/conversation",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetOrderConversationQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersRead);

        // POST /api/orders/{id}/messages - Reply to the customer (starts the chat if this is the first message)
        app.MapPost("/api/orders/{id:guid}/messages",
            async (Guid id, SendMessageRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SendStaffMessageCommand(id, request.Body));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // POST /api/orders/{id}/messages/read - The customer's messages were read (for every staff member)
        app.MapPost("/api/orders/{id:guid}/messages/read",
            async (Guid id, ISender sender) =>
                await sender.Send(new MarkOrderConversationReadCommand(id)) ? Results.NoContent() : Results.NotFound())
            .RequireAuthorization(AppPolicies.OrdersWrite);

        // POST /api/orders/{id}/messages/image - Reply with a picture (and optional text). multipart/form-data: file, body
        app.MapPost("/api/orders/{id:guid}/messages/image",
            async (Guid id, IFormFile file, [FromForm] string? body, ISender sender, IOptions<ChatImageOptions> options) =>
            {
                var data = await ChatImageUploads.ReadAsync(file, options.Value);
                var result = await sender.Send(new SendStaffMessageCommand(id, body ?? string.Empty, data));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite)
            .WithMetadata(new RequestSizeLimitAttribute(ChatImageUploads.RequestLimit))
            .DisableAntiforgery();

        // GET /api/orders/{id}/messages/{messageId}/image - One picture of the chat
        app.MapGet("/api/orders/{id:guid}/messages/{messageId:guid}/image",
            async (Guid id, Guid messageId, ISender sender, HttpContext http) =>
                ChatImageUploads.Serve(http, await sender.Send(new GetMessageImageQuery(id, messageId))))
            .RequireAuthorization(AppPolicies.OrdersRead);

        // DELETE /api/orders/{id}/messages/{messageId}/image - Remove a picture (the message stays, as "photo removed")
        app.MapDelete("/api/orders/{id:guid}/messages/{messageId:guid}/image",
            async (Guid id, Guid messageId, ISender sender) =>
            {
                var result = await sender.Send(new RemoveMessageImageCommand(id, messageId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrdersWrite);

        return app;
    }
}

/// <summary>What both chat endpoints do with an uploaded picture, and how a stored one is sent back.</summary>
internal static class ChatImageUploads
{
    /// <summary>A little over the picture limit, for the form's own overhead.</summary>
    public const long RequestLimit = ImageUploads.RequestLimit;

    /// <summary>Reads the upload into memory, refusing an empty or oversized one before any of it is processed.</summary>
    public static Task<byte[]> ReadAsync(IFormFile? file, ChatImageOptions options) =>
        ImageUploads.ReadAsync(file, options.MaxBytes);

    /// <summary>
    /// Our own content type, never sniffed (nosniff), shown in the page and not downloaded. Private to the viewer's browser,
    /// and only for a minute, so a removed picture or a revoked link stops showing quickly.
    /// </summary>
    public static IResult Serve(HttpContext http, ChatImageFile? file)
    {
        if (file == null)
        {
            return Results.NotFound();
        }

        http.Response.Headers["X-Content-Type-Options"] = "nosniff";
        http.Response.Headers.CacheControl = "private, max-age=60";
        http.Response.Headers.ContentDisposition = "inline";
        return Results.File(file.Data, file.ContentType);
    }
}
