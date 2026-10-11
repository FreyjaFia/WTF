using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Conversations;

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

        return app;
    }
}
