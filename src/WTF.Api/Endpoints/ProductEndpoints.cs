using MediatR;
using Microsoft.AspNetCore.Mvc;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Products;
using WTF.Api.Services;

namespace WTF.Api.Endpoints;

public record SetRecipeMultiplierRequest(decimal Multiplier);

public static class ProductEndpoints
{

    public static IEndpointRouteBuilder MapProducts(this IEndpointRouteBuilder app)
    {
        var productGroup = app.MapGroup("/api/products")
            .RequireAuthorization();

        // GET /api/products - Get all products (with pagination and filters)
        productGroup.MapGet("/",
            async (
                [AsParameters] GetProductsQuery query,
                ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ProductsRead);

        // GET /api/products/{id} - Get product by ID
        productGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsRead)
            .WithName("GetProductById");

        // GET /api/products/{id}/recipe-cost - What the product's recipe costs and the margin (cost roles only)
        productGroup.MapGet("/{id:guid}/recipe-cost",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductRecipeCostQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.InventoryCostsRead);

        // PUT /api/products/{id}/recipe-multiplier - How much of a drink's size-scaled recipe a size add-on uses
        productGroup.MapPut("/{id:guid}/recipe-multiplier",
            async (Guid id, SetRecipeMultiplierRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SetRecipeMultiplierCommand(id, request.Multiplier));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // POST /api/products - Create new product
        productGroup.MapPost("/",
            async (CreateProductCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetProductById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // PUT /api/products/{id} - Update product
        productGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateProductCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // DELETE /api/products/{id} - Soft delete product
        productGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteProductCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // POST /api/products/{id}/restore - Restore soft deleted product
        productGroup.MapPost("/{id:guid}/restore",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new RestoreProductCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // GET /api/products/{id}/price-history - Get price history for a product
        productGroup.MapGet("/{id:guid}/price-history",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductPriceHistoryQuery(id));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ProductsRead);

        // GET /api/products/{id}/addons - Get available add-ons for a product
        productGroup.MapGet("/{id:guid}/addons",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductAddOnsQuery(id));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ProductsRead);

        // POST /api/products/{id}/addons - Assign add-ons to a product
        productGroup.MapPost("/{id:guid}/addons",
            async (Guid id, AssignProductAddOnsCommand command, ISender sender) =>
            {
                if (id != command.ProductId)
                {
                    return Results.BadRequest("Product ID mismatch");
                }

                var result = await sender.Send(command);
                return result ? Results.Ok() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // GET /api/products/{id}/addon-price-overrides - Get add-on price overrides for product
        productGroup.MapGet("/{id:guid}/addon-price-overrides",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductAddOnPriceOverridesQuery(id));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ProductsRead);

        // POST /api/products/{id}/addon-price-overrides - Create add-on price override
        productGroup.MapPost("/{id:guid}/addon-price-overrides",
            async (Guid id, CreateProductAddOnPriceOverrideCommand command, ISender sender) =>
            {
                if (id != command.ProductId)
                {
                    return Results.BadRequest("Product ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // PUT /api/products/{id}/addon-price-overrides/{addOnId} - Update add-on price override
        productGroup.MapPut("/{id:guid}/addon-price-overrides/{addOnId:guid}",
            async (Guid id, Guid addOnId, UpdateProductAddOnPriceOverrideCommand command, ISender sender) =>
            {
                if (id != command.ProductId || addOnId != command.AddOnId)
                {
                    return Results.BadRequest("Product/Add-on ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // DELETE /api/products/{id}/addon-price-overrides/{addOnId} - Delete add-on price override
        productGroup.MapDelete("/{id:guid}/addon-price-overrides/{addOnId:guid}",
            async (Guid id, Guid addOnId, ISender sender) =>
            {
                var result = await sender.Send(new DeleteProductAddOnPriceOverrideCommand(id, addOnId));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // GET /api/products/addons/{addOnId}/products - Get products that use this add-on (reverse lookup)
        productGroup.MapGet("/addons/{addOnId:guid}/products",
            async (Guid addOnId, ISender sender) =>
            {
                var result = await sender.Send(new GetProductsByAddOnQuery(addOnId));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ProductsRead);

        // POST /api/products/addons/{addOnId}/products - Assign products to an add-on (reverse assignment)
        productGroup.MapPost("/addons/{addOnId:guid}/products",
            async (Guid addOnId, AssignAddOnProductsCommand command, ISender sender) =>
            {
                if (addOnId != command.AddOnId)
                {
                    return Results.BadRequest("Add-on ID mismatch");
                }

                var result = await sender.Send(command);
                return result ? Results.Ok() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        // POST /api/products/{id}/images - Upload product image
        productGroup.MapPost("/{id:guid}/images",
            async (Guid id, IFormFile file, ISender sender) =>
            {
                if (file == null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded");
                }

                // The size is checked before the file is read; the real type and contents are checked by the handler (ImageUploads).
                var imageData = await ImageUploads.ReadAsync(file);

                var command = new UploadProductImageCommand(id, imageData, file.FileName);
                var result = await sender.Send(command);

                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite)
            .WithMetadata(new RequestSizeLimitAttribute(ImageUploads.RequestLimit))
            .DisableAntiforgery();

        // DELETE /api/products/{id}/images - Remove product image
        productGroup.MapDelete("/{id:guid}/images",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new RemoveProductImageCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ProductsWrite);

        return app;
    }
}
