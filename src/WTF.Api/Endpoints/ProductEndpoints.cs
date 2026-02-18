using MediatR;
using WTF.Api.Common.Auth;
using WTF.Contracts.Products.Commands;
using WTF.Contracts.Products.Queries;

namespace WTF.Api.Endpoints;

public static class ProductEndpoints
{
    private static readonly string[] imageTypes = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

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
            .RequireAuthorization(AppPolicies.ManagementRead);

        // GET /api/products/{id} - Get product by ID
        productGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementRead)
            .WithName("GetProductById");

        // POST /api/products - Create new product
        productGroup.MapPost("/",
            async (CreateProductCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetProductById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

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
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // DELETE /api/products/{id} - Soft delete product
        productGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteProductCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // GET /api/products/{id}/price-history - Get price history for a product
        productGroup.MapGet("/{id:guid}/price-history",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductPriceHistoryQuery(id));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementRead);

        // GET /api/products/{id}/addons - Get available add-ons for a product
        productGroup.MapGet("/{id:guid}/addons",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductAddOnsQuery(id));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementRead);

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
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // GET /api/products/addons/{addOnId}/products - Get products that use this add-on (reverse lookup)
        productGroup.MapGet("/addons/{addOnId:guid}/products",
            async (Guid addOnId, ISender sender) =>
            {
                var result = await sender.Send(new GetProductsByAddOnQuery(addOnId));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ManagementRead);

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
            .RequireAuthorization(AppPolicies.ManagementWrite);

        // POST /api/products/{id}/images - Upload product image
        productGroup.MapPost("/{id:guid}/images",
            async (Guid id, IFormFile file, ISender sender) =>
            {
                if (file == null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded");
                }

                // Validate file type (only images)
                var allowedExtensions = imageTypes;
                var extension = Path.GetExtension(file.FileName).ToLowerInvariant();

                if (!allowedExtensions.Contains(extension))
                {
                    return Results.BadRequest("Invalid file type. Only image files are allowed.");
                }

                // Validate file size (max 5MB)
                if (file.Length > 5 * 1024 * 1024)
                {
                    return Results.BadRequest("File size exceeds 5MB limit.");
                }

                using var memoryStream = new MemoryStream();
                await file.CopyToAsync(memoryStream);
                var imageData = memoryStream.ToArray();

                var command = new UploadProductImageCommand(id, imageData, file.FileName);
                var result = await sender.Send(command);

                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ManagementWrite)
            .DisableAntiforgery();

        return app;
    }
}
