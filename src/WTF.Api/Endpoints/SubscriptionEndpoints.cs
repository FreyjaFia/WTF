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

        brand.MapPost("/logo", async (IFormFile file, ISender sender) =>
            {
                if (file == null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded");
                }

                var data = await WTF.Api.Services.ImageUploads.ReadAsync(file);
                return Results.Ok(await sender.Send(new UploadBrandLogoCommand(data)));
            })
            .RequireAuthorization(AppPolicies.BrandManage)
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(WTF.Api.Services.ImageUploads.RequestLimit))
            .DisableAntiforgery();

        brand.MapDelete("/logo", async (ISender sender) => Results.Ok(await sender.Send(new RemoveBrandLogoCommand())))
            .RequireAuthorization(AppPolicies.BrandManage);

        return app;
    }
}
