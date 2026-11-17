using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Branches;
using WTF.Calculations.Subscriptions;

namespace WTF.Api.Endpoints;

public static class BranchEndpoints
{
    public static IEndpointRouteBuilder MapBranches(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/branches")
            .RequireAuthorization();

        group.MapGet("/mine",
            async (ISender sender) => Results.Ok(await sender.Send(new GetMyBranchesQuery())));

        group.MapGet("/",
            async (string? search, string? status, ISender sender) => Results.Ok(await sender.Send(new GetBranchesQuery(search, status))))
            .RequireAuthorization(AppPolicies.BranchesRead)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapGet("/{id:guid}",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetBranchByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.BranchesRead)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapGet("/{id:guid}/close-check",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetBranchCloseCheckQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.BranchesManage)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapPost("/",
            async (BranchRequest request, ISender sender) =>
                Results.Ok(await sender.Send(new CreateBranchCommand(request.Name, request.Code, request.Address, request.Phone))))
            .RequireAuthorization(AppPolicies.BranchesManage)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapPut("/{id:guid}",
            async (Guid id, BranchRequest request, ISender sender) =>
            {
                var result = await sender.Send(new UpdateBranchCommand(id, request.Name, request.Code, request.Address, request.Phone));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.BranchesManage)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapPost("/{id:guid}/close",
            async (Guid id, CloseBranchRequest request, ISender sender) =>
            {
                var result = await sender.Send(new CloseBranchCommand(id, request.MoveStaffToBranchId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.BranchesManage)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapPost("/{id:guid}/reopen",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new ReopenBranchCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.BranchesManage)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        group.MapPost("/{id:guid}/make-main",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new MakeMainBranchCommand(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.BranchesManage)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        var users = app.MapGroup("/api/users")
            .RequireAuthorization();

        users.MapGet("/{id:guid}/branch-access",
            async (Guid id, ISender sender) =>
            {
                var result = await sender.Send(new GetUserBranchAccessQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersRead);

        users.MapPut("/{id:guid}/branch-access",
            async (Guid id, UserBranchAccessRequest request, ISender sender) =>
            {
                var result = await sender.Send(new SetUserBranchAccessCommand(id, request.IsAllBranches, request.BranchIds, request.DefaultBranchId));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.UsersWrite)
            .RequireAuthorization(AppPolicies.RequireFeature(PlanFeatures.Branches));

        return app;
    }
}
