using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.OrderLinks;

namespace WTF.Api.Endpoints;

public record SetOrderingLinkAccessRequest(bool Allow);

public record CreateOrderLinkRequest(DateTime? ExpiresAt);

public static class OrderLinkEndpoints
{
    public static IEndpointRouteBuilder MapOrderLinks(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/customers/{id:guid}")
            .RequireAuthorization();

        // PUT /api/customers/{id}/ordering-link-access - Enable or disable ordering links for a customer
        group.MapPut("/ordering-link-access",
            async (Guid id, SetOrderingLinkAccessRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SetOrderingLinkAccessCommand(id, request.Allow));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrderLinksManage);

        // POST /api/customers/{id}/ordering-links - Generate a link (optional end date)
        group.MapPost("/ordering-links",
            async (Guid id, CreateOrderLinkRequest request, ISender sender) =>
            {
                var result = await sender.Send(new CreateOrderLinkCommand(id, request.ExpiresAt));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrderLinksManage);

        // GET /api/customers/{id}/ordering-links - List the customer's links with their status
        group.MapGet("/ordering-links",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetOrderLinksQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.CustomersRead);

        // DELETE /api/customers/{id}/ordering-links/{linkId} - Revoke a link
        group.MapDelete("/ordering-links/{linkId:guid}",
            async (Guid id, Guid linkId, ISender sender) =>
            {
                var result = await sender.Send(new RevokeOrderLinkCommand(id, linkId));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.OrderLinksManage);

        return app;
    }
}
