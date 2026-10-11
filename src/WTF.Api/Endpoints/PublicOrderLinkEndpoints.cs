using MediatR;
using WTF.Api.Features.OrderLinks;

namespace WTF.Api.Endpoints;

/// <summary>
/// Anonymous routes behind a customer's ordering link. Every route runs the same token check and answers with the
/// same 404 for any invalid, expired, revoked or unknown token.
/// </summary>
public static class PublicOrderLinkEndpoints
{
    public const string RateLimitPolicy = "order-link-policy";

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

        // GET /api/public/order-links/{token}/orders/{orderId} - One of my orders
        group.MapGet("/orders/{orderId:guid}",
            async (string token, Guid orderId, ISender sender) =>
            {
                var result = await sender.Send(new GetPublicOrderQuery(token, orderId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        return app;
    }
}
