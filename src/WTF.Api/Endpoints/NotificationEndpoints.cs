using MediatR;
using WTF.Api.Features.Notifications;

namespace WTF.Api.Endpoints;

public record MarkNotificationsReadRequest(List<Guid>? Ids, string? Kind);

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotifications(this IEndpointRouteBuilder app)
    {
        // Any signed-in person: a person only ever sees the rows addressed to them.
        var group = app.MapGroup("/api/notifications")
            .RequireAuthorization();

        group.MapGet("/",
            async (string? kind, bool? unreadOnly, int? page, int? pageSize, ISender sender) =>
            {
                var result = await sender.Send(new GetNotificationsQuery(kind, unreadOnly ?? false, page ?? 1, pageSize ?? 25));
                return Results.Ok(result);
            });

        group.MapGet("/counts",
            async (ISender sender) => Results.Ok(await sender.Send(new GetNotificationCountsQuery())));

        group.MapPost("/read",
            async (MarkNotificationsReadRequest request, ISender sender) =>
                Results.Ok(await sender.Send(new MarkNotificationsReadCommand(request.Ids, request.Kind))));

        return app;
    }
}
