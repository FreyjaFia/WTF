using MediatR;
using WTF.Contracts.Products.Commands;
using WTF.Contracts.Products.Queries;

namespace WTF.Api.Endpoints;

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
            });

        // GET /api/products/{id} - Get product by ID
        productGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            });

        // POST /api/products - Create new product
        productGroup.MapPost("/",
            async (CreateProductCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetProductById", new { id = result.Id }, result);
            });

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
            });

        // DELETE /api/products/{id} - Soft delete product
        productGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteProductCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            });

        // GET /api/products/{id}/price-history - Get price history for a product
        productGroup.MapGet("/{id:guid}/price-history",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetProductPriceHistoryQuery(id));
                return Results.Ok(result);
            });

        // POST /api/products/{id}/upload-image - Upload product image
        productGroup.MapPost("/{id:guid}/upload-image",
            async (Guid id, IFormFile file, ISender sender) =>
            {
                if (file == null || file.Length == 0)
                {
                    return Results.BadRequest("No file uploaded");
                }

                // Validate file type (only images)
                var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
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
            .DisableAntiforgery();

        return app;
    }
}
