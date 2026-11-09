using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Roles;

namespace WTF.Api.Endpoints;

public static class RoleEndpoints
{
    public static IEndpointRouteBuilder MapRoles(this IEndpointRouteBuilder app)
    {
        var roleGroup = app.MapGroup("/api/roles")
            .RequireAuthorization();

        // GET /api/roles - Built-in roles and this shop's custom roles
        roleGroup.MapGet("/",
            async (ISender sender) => Results.Ok(await sender.Send(new GetRolesQuery())))
            .RequireAuthorization(AppPolicies.RolesRead);

        // GET /api/roles/permissions - Every permission a role can hold
        roleGroup.MapGet("/permissions",
            async (ISender sender) => Results.Ok(await sender.Send(new GetPermissionCatalogQuery())))
            .RequireAuthorization(AppPolicies.RolesRead);

        // GET /api/roles/{id} - One role with its permissions
        roleGroup.MapGet("/{id:int}",
            async (int id, ISender sender) =>
            {
                var result = await sender.Send(new GetRoleByIdQuery(id));
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.RolesRead)
            .WithName("GetRoleById");

        // POST /api/roles - Create a custom role
        roleGroup.MapPost("/",
            async (CreateRoleCommand command, ISender sender) =>
            {
                var result = await sender.Send(command);
                return Results.CreatedAtRoute("GetRoleById", new { id = result.Id }, result);
            })
            .RequireAuthorization(AppPolicies.RolesManage);

        // PUT /api/roles/{id} - Change a custom role
        roleGroup.MapPut("/{id:int}",
            async (int id, UpdateRoleCommand command, ISender sender) =>
            {
                if (id != command.Id)
                {
                    return Results.BadRequest("ID mismatch");
                }

                var result = await sender.Send(command);
                return result is not null ? Results.Ok(result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.RolesManage);

        // POST /api/roles/{id}/duplicate - Copy any role into a new custom role
        roleGroup.MapPost("/{id:int}/duplicate",
            async (int id, ISender sender) =>
            {
                var result = await sender.Send(new DuplicateRoleCommand(id));
                return result is not null ? Results.CreatedAtRoute("GetRoleById", new { id = result.Id }, result) : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.RolesManage);

        // DELETE /api/roles/{id} - Delete a custom role nobody uses
        roleGroup.MapDelete("/{id:int}",
            async (int id, ISender sender) =>
            {
                var result = await sender.Send(new DeleteRoleCommand(id));
                return result ? Results.NoContent() : Results.NotFound();
            })
            .RequireAuthorization(AppPolicies.RolesManage);

        return app;
    }
}
