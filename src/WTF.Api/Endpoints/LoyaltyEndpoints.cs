using MediatR;
using WTF.Api.Features.Loyalty.GenerateShortLink;
using WTF.Api.Features.Loyalty.GetLoyaltyPoints;
using WTF.Api.Features.Loyalty.RedirectToLoyalty;

namespace WTF.Api.Endpoints
{
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

                    if (!result.CustomerId.HasValue)
                        return Results.NotFound("Invalid or expired link.");

                    return Results.Ok(result);
                });

            return app;
        }
    }
}
