using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Catalog;

namespace WTF.Api.Endpoints;

public record CatalogEntryRequest(string Name, int SortOrder);

public record SubCategoryRequest(string Name, int CategoryId, int SortOrder);

public record AddOnTypeRequest(string Name, bool IsRequired, int MinSelect, int MaxSelect, int SortOrder);

public record ActiveRequest(bool IsActive);

public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalog(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/catalog").RequireAuthorization();

        group.MapGet("/",
            async (ISender sender) => Results.Ok(await sender.Send(new GetCatalogSetupQuery())))
            .RequireAuthorization(AppPolicies.ProductsRead);

        group.MapPost("/categories",
            async (CatalogEntryRequest body, ISender sender) =>
                Results.Ok(new { id = await sender.Send(new SaveCategoryCommand(null, body.Name, body.SortOrder)) }))
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPut("/categories/{id:int}",
            async (int id, CatalogEntryRequest body, ISender sender) =>
                Results.Ok(new { id = await sender.Send(new SaveCategoryCommand(id, body.Name, body.SortOrder)) }))
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPut("/categories/{id:int}/active",
            async (int id, ActiveRequest body, ISender sender) =>
            {
                await sender.Send(new SetCategoryActiveCommand(id, body.IsActive));
                return Results.NoContent();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPost("/subcategories",
            async (SubCategoryRequest body, ISender sender) =>
                Results.Ok(new { id = await sender.Send(new SaveSubCategoryCommand(null, body.Name, body.CategoryId, body.SortOrder)) }))
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPut("/subcategories/{id:int}",
            async (int id, SubCategoryRequest body, ISender sender) =>
                Results.Ok(new { id = await sender.Send(new SaveSubCategoryCommand(id, body.Name, body.CategoryId, body.SortOrder)) }))
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPut("/subcategories/{id:int}/active",
            async (int id, ActiveRequest body, ISender sender) =>
            {
                await sender.Send(new SetSubCategoryActiveCommand(id, body.IsActive));
                return Results.NoContent();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPost("/addon-types",
            async (AddOnTypeRequest body, ISender sender) =>
                Results.Ok(new { id = await sender.Send(new SaveAddOnTypeCommand(null, body.Name, body.IsRequired, body.MinSelect, body.MaxSelect, body.SortOrder)) }))
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPut("/addon-types/{id:int}",
            async (int id, AddOnTypeRequest body, ISender sender) =>
                Results.Ok(new { id = await sender.Send(new SaveAddOnTypeCommand(id, body.Name, body.IsRequired, body.MinSelect, body.MaxSelect, body.SortOrder)) }))
            .RequireAuthorization(AppPolicies.ProductsWrite);

        group.MapPut("/addon-types/{id:int}/active",
            async (int id, ActiveRequest body, ISender sender) =>
            {
                await sender.Send(new SetAddOnTypeActiveCommand(id, body.IsActive));
                return Results.NoContent();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        return app;
    }
}
