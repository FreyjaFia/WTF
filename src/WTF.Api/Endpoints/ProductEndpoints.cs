using MediatR;
using Microsoft.AspNetCore.Authorization;
using WTF.Contracts.Products.Commands;
using WTF.Contracts.Products.Queries;

namespace WTF.Api.Endpoints;

public static class ProductEndpoints
{
    public static IEndpointRouteBuilder MapProducts(this IEndpointRouteBuilder app)
    {
        var productGroup = app.MapGroup("/api/products");
            //.RequireAuthorization(); // All product endpoints require authentication

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

        return app;
    }
}
