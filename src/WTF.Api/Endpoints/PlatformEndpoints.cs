using MediatR;
using Microsoft.AspNetCore.Mvc;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Platform;
using WTF.Api.Features.Subscriptions;

namespace WTF.Api.Endpoints;

public static class PlatformEndpoints
{
    public const string LoginRateLimitPolicy = "platform-login-policy";

    public record StatusRequest(string? Reason);

    public record ImpersonateRequest(string Reason, bool AllowWrites);

    public record UpdatePlanRequest(string Name, decimal MonthlyPrice, string[] Features, int? MaxUsers, bool IsActive);

    public record SetSubscriptionRequest(int PlanId, DateTime? PeriodEnd, int GraceDays, decimal DiscountPercent, string? Notes);

    public record CreateInvoiceRequest(int Months, string? Reference, DateTime? DueDate, string? Notes);

    public record MarkPaidRequest(string? Reference);

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

        group.MapGet("/plans", async (ISender sender) => Results.Ok(await sender.Send(new GetPlansQuery())));

        group.MapPut("/plans/{id:int}", async (int id, [FromBody] UpdatePlanRequest request, ISender sender) =>
            Results.Ok(await sender.Send(new UpdatePlanCommand(id, request.Name, request.MonthlyPrice, request.Features, request.MaxUsers, request.IsActive))));

        group.MapGet("/tenants/{id:guid}/subscription", async (Guid id, ISender sender) =>
            Results.Ok(await sender.Send(new GetTenantSubscriptionQuery(id))));

        group.MapPut("/tenants/{id:guid}/subscription", async (Guid id, [FromBody] SetSubscriptionRequest request, ISender sender) =>
            Results.Ok(await sender.Send(new SetTenantSubscriptionCommand(id, request.PlanId, request.PeriodEnd, request.GraceDays, request.DiscountPercent, request.Notes))));

        group.MapPost("/tenants/{id:guid}/invoices", async (Guid id, [FromBody] CreateInvoiceRequest request, ISender sender) =>
            Results.Ok(await sender.Send(new CreateInvoiceCommand(id, request.Months, request.Reference, request.DueDate, request.Notes))));

        group.MapPost("/invoices/{invoiceId:guid}/mark-paid", async (Guid invoiceId, [FromBody] MarkPaidRequest request, ISender sender) =>
            Results.Ok(await sender.Send(new MarkInvoicePaidCommand(invoiceId, request?.Reference))));

        group.MapPost("/invoices/{invoiceId:guid}/void", async (Guid invoiceId, ISender sender) =>
            Results.Ok(await sender.Send(new VoidInvoiceCommand(invoiceId))));

        group.MapGet("/tenants/{id:guid}/brand", async (Guid id, ISender sender) =>
            Results.Ok(await sender.Send(new GetTenantBrandQuery(id))));

        group.MapPut("/tenants/{id:guid}/brand", async (Guid id, [FromBody] BrandDto brand, ISender sender) =>
            Results.Ok(await sender.Send(new SetTenantBrandCommand(id, brand))));

        group.MapGet("/audit-logs", async ([AsParameters] GetPlatformAuditLogsQuery query, ISender sender) =>
            Results.Ok(await sender.Send(query)));

        return app;
    }

    private static async Task<IResult> ChangeStatusAsync(Guid id, TenantStatusChange change, StatusRequest request, ISender sender)
    {
        return Results.Ok(await sender.Send(new SetTenantStatusCommand(id, change, request?.Reason)));
    }
}
