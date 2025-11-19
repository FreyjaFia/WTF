using MediatR;
using WTF.Contracts.Loyalty.GenerateShortLink;
using WTF.Contracts.Loyalty.GetLoyaltyPoints;
using WTF.Contracts.Loyalty.RedirectToLoyalty;

namespace WTF.Api.Endpoints;

public static class LoyaltyEndpoints
{
    public static IEndpointRouteBuilder MapLoyalty(this IEndpointRouteBuilder app)
    {
        var loyaltyGroup = app.MapGroup("/api/loyalty")
            .RequireRateLimiting("loyalty-policy");

        loyaltyGroup.MapGet("/{customerId:guid}",
            async (Guid customerId, ISender sender) =>
            {
                var result = await sender.Send(new GetLoyaltyPointsQuery(customerId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        loyaltyGroup.MapPost("/generate/{customerId:guid}",
            async (Guid customerId, ISender sender) =>
            {
                var result = await sender.Send(new GenerateShortLinkCommand(customerId));
                return Results.Ok(result);
            });

        loyaltyGroup.MapGet("/redirect/{token}",
            async (string token, ISender sender) =>
            {
                var result = await sender.Send(new RedirectToLoyaltyQuery(token));

                return !result.CustomerId.HasValue ? Results.NotFound("Invalid or expired link.") : Results.Ok(result);
            });

        return app;
    }
}