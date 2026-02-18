using MediatR;
using WTF.Api.Common.Auth;
using WTF.Contracts.Customers.Commands;
using WTF.Contracts.Customers.Queries;

namespace WTF.Api.Endpoints;

public static class CustomerEndpoints
{
    public static IEndpointRouteBuilder MapCustomers(this IEndpointRouteBuilder app)
    {
        var customerGroup = app.MapGroup("/api/customers")
            .RequireAuthorization();

        // GET /api/customers - Get all customers (with pagination and search)
        customerGroup.MapGet("/",
            async (
                [AsParameters] GetCustomersQuery query,
                ISender sender) =>
            {
                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.CustomersRead);

        // GET /api/customers/{id} - Get customer by ID
        customerGroup.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetCustomerByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.CustomersRead)
            .WithName("GetCustomerById");

        // POST /api/customers - Create new customer
        customerGroup.MapPost("/",
            async (CreateCustomerCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetCustomerById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.CustomersCreate);

        // PUT /api/customers/{id} - Update customer
        customerGroup.MapPut("/{id:guid}",
            async (Guid id, UpdateCustomerCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.CustomersWrite);

        // DELETE /api/customers/{id} - Delete customer
        customerGroup.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteCustomerCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.CustomersWrite);

        // POST /api/customers/{id}/image - Upload customer image
        customerGroup.MapPost("/{id:guid}/image",
            async (Guid id, HttpRequest request, ISender sender) =>
            {
                if (!request.HasFormContentType || !request.Form.Files.Any())
                {
                    return Results.BadRequest("No file provided");
                }

                var file = request.Form.Files[0];
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                var data = ms.ToArray();

                var result = await sender.Send(new UploadCustomerImageCommand(id, data, file.FileName));
                return result is not null ? Results.Ok(result) : Results.BadRequest();
            })
            .RequireAuthorization(AppPolicies.CustomersWrite);

        return app;
    }
}
