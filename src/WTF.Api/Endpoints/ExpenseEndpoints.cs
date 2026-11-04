using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Expenses;

namespace WTF.Api.Endpoints;

public static class ExpenseEndpoints
{
    public static IEndpointRouteBuilder MapExpenses(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/expenses")
            .RequireAuthorization();

        group.MapGet("/",
            async ([AsParameters] GetExpensesQuery query, ISender sender) =>
            {
                if (query.FromDate.HasValue && query.ToDate.HasValue && query.FromDate > query.ToDate)
                {
                    return Results.BadRequest(new { message = "The start date must not be after the end date." });
                }

                var result = await sender.Send(query);
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ExpensesRead);

        group.MapGet("/categories",
            async (ISender sender) =>
            {
                var result = await sender.Send(new GetExpenseCategoriesQuery());
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ExpensesRead);

        group.MapPost("/",
            async (ExpenseRequest request, ISender sender) =>
            {
                var result = await sender.Send(new CreateExpenseCommand(request.ExpenseDate, request.Category, request.Amount, request.Note));
                return Results.Ok(result);
            })
            .RequireAuthorization(AppPolicies.ExpensesWrite);

        group.MapPut("/{id:guid}",
            async (Guid id, ExpenseRequest request, ISender sender) =>
            {
                var result = await sender.Send(new UpdateExpenseCommand(id, request.ExpenseDate, request.Category, request.Amount, request.Note));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ExpensesWrite);

        group.MapDelete("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteExpenseCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ExpensesWrite);

        group.MapPost("/{id:guid}/restore",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new RestoreExpenseCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.ExpensesWrite);

        return app;
    }
}
