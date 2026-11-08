using MediatR;
using Microsoft.AspNetCore.Mvc;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Platform;

namespace WTF.Api.Endpoints;

public static class PlatformEndpoints
{
    public const string LoginRateLimitPolicy = "platform-login-policy";

    public record StatusRequest(string? Reason);

    public record ImpersonateRequest(string Reason, bool AllowWrites);

    public record DeleteRequest(string Slug, string AdminPassword);

    public static IEndpointRouteBuilder MapPlatform(this IEndpointRouteBuilder app)
    {
        var login = app.MapGroup("/api/platform/auth").RequireRateLimiting(LoginRateLimitPolicy);
        login.MapPost("/login", async (PlatformLoginCommand command, ISender sender) =>
        {
            var result = await sender.Send(command);
            return result is not null ? Results.Ok(result) : Results.Unauthorized();
        });

        var group = app.MapGroup("/api/platform").RequireAuthorization(AppPolicies.PlatformAdmin);

        group.MapGet("/tenants", async (ISender sender) => Results.Ok(await sender.Send(new GetPlatformTenantsQuery())));

        group.MapPost("/tenants", async (CreateTenantCommand command, ISender sender) =>
            Results.Ok(await sender.Send(command)));

        group.MapPost("/tenants/{id:guid}/suspend", async (Guid id, [FromBody] StatusRequest request, ISender sender) =>
            await ChangeStatusAsync(id, TenantStatusChange.Suspend, request, sender));

        group.MapPost("/tenants/{id:guid}/resume", async (Guid id, [FromBody] StatusRequest request, ISender sender) =>
            await ChangeStatusAsync(id, TenantStatusChange.Resume, request, sender));

        group.MapPost("/tenants/{id:guid}/cancel", async (Guid id, [FromBody] StatusRequest request, ISender sender) =>
            await ChangeStatusAsync(id, TenantStatusChange.Cancel, request, sender));

        group.MapGet("/tenants/{id:guid}/users", async (Guid id, ISender sender) =>
            Results.Ok(await sender.Send(new GetTenantUsersQuery(id))));

        group.MapPost("/tenants/{id:guid}/users/{userId:guid}/reset-password", async (Guid id, Guid userId, ISender sender) =>
            Results.Ok(await sender.Send(new ResetTenantUserPasswordCommand(id, userId))));

        group.MapPost("/tenants/{id:guid}/users/{userId:guid}/impersonate", async (Guid id, Guid userId, [FromBody] ImpersonateRequest request, ISender sender) =>
            Results.Ok(await sender.Send(new ImpersonateCommand(id, userId, request.Reason, request.AllowWrites))));

        group.MapGet("/tenants/{id:guid}/export", async (Guid id, ISender sender) =>
        {
            var export = await sender.Send(new ExportTenantQuery(id));
            return Results.File(export.Content, "application/zip", export.FileName);
        });

        group.MapGet("/tenants/{id:guid}/deletion-preview", async (Guid id, ISender sender) =>
            Results.Ok(await sender.Send(new GetDeletionPreviewQuery(id))));

        group.MapPost("/tenants/{id:guid}/delete", async (Guid id, [FromBody] DeleteRequest request, ISender sender) =>
        {
            return Results.Ok(await sender.Send(new DeleteTenantCommand(id, request.Slug, request.AdminPassword)));
        });

        group.MapGet("/audit-logs", async ([AsParameters] GetPlatformAuditLogsQuery query, ISender sender) =>
            Results.Ok(await sender.Send(query)));

        return app;
    }

    private static async Task<IResult> ChangeStatusAsync(Guid id, TenantStatusChange change, StatusRequest request, ISender sender)
    {
        return Results.Ok(await sender.Send(new SetTenantStatusCommand(id, change, request?.Reason)));
    }
}
