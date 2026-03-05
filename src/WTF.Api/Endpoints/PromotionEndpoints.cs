using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;

namespace WTF.Api.Endpoints;

public static class PromotionEndpoints
{
    public static IEndpointRouteBuilder MapPromotions(this IEndpointRouteBuilder app)
    {
        var adminGroup = app.MapGroup("/api/management/promotions")
            .RequireAuthorization(AppPolicies.ManagementRead);
        var adminFixedBundleGroup = app.MapGroup("/api/management/promotions/fixed-bundles")
            .RequireAuthorization(AppPolicies.ManagementRead);
        var adminMixMatchGroup = app.MapGroup("/api/management/promotions/mix-match")
            .RequireAuthorization(AppPolicies.ManagementRead);
        var posGroup = app.MapGroup("/api/pos/promotions")
            .RequireAuthorization(AppPolicies.OrdersWrite);

        adminGroup.MapPost("/{promotionId:guid}/images",
            async (Guid promotionId, HttpRequest httpRequest, ISender sender) =>
            {
                if (!httpRequest.HasFormContentType)
                {
                    return Results.BadRequest("Expected multipart/form-data.");
                }

                var form = await httpRequest.ReadFormAsync();
                var file = form.Files["file"] ?? form.Files.FirstOrDefault();
                if (file is null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded.");
                }

                using var stream = file.OpenReadStream();
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms);
                var data = ms.ToArray();

                var result = await sender.Send(new UploadPromotionImageCommand(promotionId, data, file.FileName));
                return result is null ? Results.NotFound() : Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        adminGroup.MapDelete("/{promotionId:guid}/images",
            async (Guid promotionId, ISender sender) =>
            {
                var result = await sender.Send(new RemovePromotionImageCommand(promotionId));
                return result is null ? Results.NotFound() : Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        adminFixedBundleGroup.MapGet("/",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetFixedBundlePromotionsQuery());
                return Results.Ok(result);
            });

        adminFixedBundleGroup.MapGet("/{promotionId:guid}",
            async (Guid promotionId, ISender sender) =>
            {
                var result = await sender.Send(new GetFixedBundlePromotionByIdQuery(promotionId));
                return result is null ? Results.NotFound() : Results.Ok(result);
            });

        adminFixedBundleGroup.MapPost("/",
            async (CreateFixedBundlePromotionCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        adminFixedBundleGroup.MapPut("/{promotionId:guid}",
            async (Guid promotionId, UpdateFixedBundlePromotionCommand command, ISender sender) =>
            {
                if (promotionId != command.PromotionId)
                {
                    return Results.BadRequest("Promotion ID mismatch.");
                }

                var result = await sender.Send(command);
                return result is null ? Results.NotFound() : Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        adminFixedBundleGroup.MapDelete("/{promotionId:guid}",
            async (Guid promotionId, ISender sender) =>
            {
                var removed = await sender.Send(new DeleteFixedBundlePromotionCommand(promotionId));
                return removed ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        void MapMixMatchRoutes(RouteGroupBuilder group)
        {
            group.MapGet("/",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetMixMatchPromotionsQuery());
                return Results.Ok(result);
            });

            group.MapGet("/{promotionId:guid}",
            async (Guid promotionId, ISender sender) =>
            {
                var result = await sender.Send(new GetMixMatchPromotionByIdQuery(promotionId));
                return result is null ? Results.NotFound() : Results.Ok(result);
            });

            group.MapPost("/",
            async (CreateMixMatchPromotionCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

            group.MapPut("/{promotionId:guid}",
            async (Guid promotionId, UpdateMixMatchPromotionCommand command, ISender sender) =>
            {
                if (promotionId != command.PromotionId)
                {
                    return Results.BadRequest("Promotion ID mismatch.");
                }

                var result = await sender.Send(command);
                return result is null ? Results.NotFound() : Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

            group.MapDelete("/{promotionId:guid}",
            async (Guid promotionId, ISender sender) =>
            {
                var removed = await sender.Send(new DeleteMixMatchPromotionCommand(promotionId));
                return removed ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);
        }

        MapMixMatchRoutes(adminMixMatchGroup);

        posGroup.MapPost("/evaluate",
            async (EvaluatePromotionsRequestDto request, ISender sender) =>
            {
                var result = await sender.Send(new EvaluatePromotionsCommand(request));
                return Results.Ok(result);
            });

        return app;
    }
}

