using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;

namespace WTF.Api.Endpoints;

/// <summary>
/// Anonymous routes behind a customer's ordering link. Every route runs the same token check and answers with the
/// same 404 for any invalid, expired, revoked or unknown token.
/// </summary>
public static class PublicOrderLinkEndpoints
{
    public const string RateLimitPolicy = "order-link-policy";
    public const string ChatRateLimitPolicy = "order-chat-policy";
    public const string ChatImageRateLimitPolicy = "order-chat-image-policy";

    public static IEndpointRouteBuilder MapPublicOrderLinks(this IEndpointRouteBuilder app)
    {
        // The catalog and prices must always be fresh: customers must never order from a stale list, so no browser
        // or proxy may keep a copy of these responses.
        var group = app.MapGroup("/api/public/order-links/{token}")
            .RequireRateLimiting(RateLimitPolicy)
            .AddEndpointFilter(async (context, next) =>
            {
                context.HttpContext.Response.Headers.CacheControl = "no-store";
                return await next(context);
            });

        // GET /api/public/order-links/{token} - Validate the link; returns the customer's first name and the catalog
        group.MapGet("/",
            async (string token, ISender sender) =>
            {
                var result = await sender.Send(new GetPublicOrderLinkQuery(token));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // GET /api/public/order-links/{token}/orders - My orders
        group.MapGet("/orders",
            async (string token, ISender sender, int page = 1, int pageSize = 20) =>
            {
                var result = await sender.Send(new GetPublicOrdersQuery(token, page, pageSize));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/public/order-links/{token}/orders - Place an order (waits for staff approval)
        group.MapPost("/orders",
            async (string token, SubmitPublicOrderRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SubmitPublicOrderCommand(token, request));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // GET /api/public/order-links/{token}/orders/{orderId} - One of my orders
        group.MapGet("/orders/{orderId:guid}",
            async (string token, Guid orderId, ISender sender) =>
            {
                var result = await sender.Send(new GetPublicOrderQuery(token, orderId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // GET /api/public/order-links/{token}/conversations - The envelope list: my order chats
        group.MapGet("/conversations",
            async (string token, ISender sender) =>
            {
                var result = await sender.Send(new GetPublicConversationsQuery(token));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // GET /api/public/order-links/{token}/orders/{orderId}/messages - The chat of one of my orders
        group.MapGet("/orders/{orderId:guid}/messages",
            async (string token, Guid orderId, ISender sender) =>
            {
                var result = await sender.Send(new GetPublicOrderConversationQuery(token, orderId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/public/order-links/{token}/orders/{orderId}/messages - Write to the shop about my order
        group.MapPost("/orders/{orderId:guid}/messages",
            async (string token, Guid orderId, SendMessageRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SendPublicMessageCommand(token, orderId, request.Body));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireRateLimiting(ChatRateLimitPolicy);

        // POST /api/public/order-links/{token}/orders/{orderId}/messages/image - Send the shop a picture (multipart: file, body)
        group.MapPost("/orders/{orderId:guid}/messages/image",
            async (string token, Guid orderId, IFormFile file, [FromForm] string? body, ISender sender, IOptions<ChatImageOptions> options) =>
            {
                var data = await ChatImageUploads.ReadAsync(file, options.Value);
                var result = await sender.Send(new SendPublicMessageCommand(token, orderId, body ?? string.Empty, data));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireRateLimiting(ChatImageRateLimitPolicy)
            .WithMetadata(new RequestSizeLimitAttribute(ChatImageUploads.RequestLimit))
            .DisableAntiforgery();

        // GET /api/public/order-links/{token}/orders/{orderId}/messages/{messageId}/image - One picture of my chat
        group.MapGet("/orders/{orderId:guid}/messages/{messageId:guid}/image",
            async (string token, Guid orderId, Guid messageId, ISender sender, HttpContext http) =>
                ChatImageUploads.Serve(http, await sender.Send(new GetPublicMessageImageQuery(token, orderId, messageId))));

        // DELETE /api/public/order-links/{token}/orders/{orderId}/messages/{messageId}/image - Take back a picture I sent
        group.MapDelete("/orders/{orderId:guid}/messages/{messageId:guid}/image",
            async (string token, Guid orderId, Guid messageId, ISender sender) =>
            {
                var result = await sender.Send(new RemovePublicMessageImageCommand(token, orderId, messageId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/public/order-links/{token}/orders/{orderId}/messages/read - I read the shop's replies
        group.MapPost("/orders/{orderId:guid}/messages/read",
            async (string token, Guid orderId, ISender sender) =>
                await sender.Send(new MarkPublicConversationReadCommand(token, orderId))
                    ? Results.NoContent()
                    : Results.NotFound());

        return app;
    }
}
