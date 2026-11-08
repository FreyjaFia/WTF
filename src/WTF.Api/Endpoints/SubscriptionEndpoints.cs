using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Subscriptions;

namespace WTF.Api.Endpoints;

public static class SubscriptionEndpoints
{
    public static IEndpointRouteBuilder MapSubscriptions(this IEndpointRouteBuilder app)
    {
        var subscription = app.MapGroup("/api/subscription").RequireAuthorization();

        subscription.MapGet("/", async (ISender sender) => Results.Ok(await sender.Send(new GetSubscriptionQuery())));

        subscription.MapGet("/invoices", async (ISender sender) => Results.Ok(await sender.Send(new GetMyInvoicesQuery())))
            .RequireAuthorization(AppPolicies.SubscriptionBilling);

        var brand = app.MapGroup("/api/settings/brand").RequireAuthorization();

        brand.MapGet("/", async (ISender sender) => Results.Ok(await sender.Send(new GetBrandQuery())));

        brand.MapPut("/", async (BrandDto body, ISender sender) => Results.Ok(await sender.Send(new UpdateBrandCommand(body))))
            .RequireAuthorization(AppPolicies.BrandManage);

        return app;
    }
}
