using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Subscriptions;

public record SubscriptionDto(
    bool Managed,
    string? PlanName,
    string? PlanCode,
    string[] Features,
    string Warning,
    int DaysLeft,
    DateTime? PeriodEnd,
    DateTime? AccessUntil,
    int GraceDays,
    DateTime ServerTime,
    string? Lease,
    int LeaseMaxAgeDays,
    Dictionary<string, string[]>? PlansByFeature = null);

public record TenantInvoiceDto(
    Guid Id,
    string PlanName,
    DateTime PeriodStart,
    DateTime PeriodEnd,
    int Months,
    decimal Amount,
    byte Status,
    string StatusName,
    string? Reference,
    DateTime? DueDate,
    DateTime? PaidAt,
    DateTime CreatedAt);

public static class SubscriptionNames
{
    public const byte InvoiceOpen = 1;
    public const byte InvoicePaid = 2;
    public const byte InvoiceVoid = 3;

    public static string Warning(SubscriptionWarning warning) => JsonNamingPolicy.CamelCase.ConvertName(warning.ToString());

    public static string InvoiceStatus(byte status) => status switch
    {
        InvoiceOpen => "Open",
        InvoicePaid => "Paid",
        InvoiceVoid => "Void",
        _ => "Unknown"
    };
}

public record GetSubscriptionQuery : IRequest<SubscriptionDto>;

// What the signed-in person's own shop owes: plan, period, the warning level and a signed lease the device keeps for offline use.
public class GetSubscriptionHandler(
    WTFDbContext db,
    ICurrentTenant currentTenant,
    ILeaseSigner signer,
    Microsoft.Extensions.Options.IOptions<SubscriptionOptions> options,
    TimeProvider clock) : IRequestHandler<GetSubscriptionQuery, SubscriptionDto>
{
    public async Task<SubscriptionDto> Handle(GetSubscriptionQuery request, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var maxAge = options.Value.LeaseMaxAgeDays;

        // Single-shop installs and shops without a subscription row are never limited.
        if (!currentTenant.FilterEnabled || currentTenant.TenantId is not { } tenantId
            || await SubscriptionStateLoader.LoadAsync(db, tenantId, now, cancellationToken) is not { } state)
        {
            return new SubscriptionDto(false, null, null, [], SubscriptionNames.Warning(SubscriptionWarning.None), 0, null, null, 0, now, null, maxAge, []);
        }

        var lease = signer.Sign(new LeasePayload(1, tenantId, now, state.PeriodEnd, state.GraceDays, state.AccessUntil, maxAge));

        return new SubscriptionDto(
            true,
            state.PlanName,
            state.PlanCode,
            [.. PlanFeatures.Normalize(state.Features)],
            SubscriptionNames.Warning(state.Warning),
            state.DaysLeft,
            state.PeriodEnd,
            state.AccessUntil,
            state.GraceDays,
            now,
            lease,
            maxAge,
            await PlansByFeatureAsync(cancellationToken));
    }

    // For the "Available in Pro" text: the active plans that hold each switchable feature, in plan order.
    private async Task<Dictionary<string, string[]>> PlansByFeatureAsync(CancellationToken cancellationToken)
    {
        var plans = await db.Plans.AsNoTracking().Where(p => p.IsActive).OrderBy(p => p.SortOrder)
            .Select(p => new { p.Name, p.Features }).ToListAsync(cancellationToken);
        var rows = plans.Select(p => (p.Name, (string?)p.Features)).ToList();

        return PlanFeatures.Gateable.ToDictionary(feature => feature, feature => PlanFeatures.PlansContaining(feature, rows).ToArray());
    }
}

public record GetMyInvoicesQuery : IRequest<List<TenantInvoiceDto>>;

public class GetMyInvoicesHandler(WTFDbContext db, ICurrentTenant currentTenant) : IRequestHandler<GetMyInvoicesQuery, List<TenantInvoiceDto>>
{
    public async Task<List<TenantInvoiceDto>> Handle(GetMyInvoicesQuery request, CancellationToken cancellationToken)
    {
        if (currentTenant.StampTenantId is not { } tenantId)
        {
            return [];
        }

        var invoices = await db.TenantInvoices
            .AsNoTracking()
            .Where(i => i.TenantId == tenantId && i.Status != SubscriptionNames.InvoiceVoid)
            .OrderByDescending(i => i.CreatedAt)
            .Take(100)
            .ToListAsync(cancellationToken);

        var plans = await db.Plans.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        return [.. invoices.Select(i => InvoiceMapping.ToDto(i, plans))];
    }
}

public static class InvoiceMapping
{
    public static TenantInvoiceDto ToDto(Domain.Entities.TenantInvoice i, IReadOnlyDictionary<int, string> plans) => new(
        i.Id,
        plans.GetValueOrDefault(i.PlanId, string.Empty),
        i.PeriodStart,
        i.PeriodEnd,
        i.Months,
        i.Amount,
        i.Status,
        SubscriptionNames.InvoiceStatus(i.Status),
        i.Reference,
        i.DueDate,
        i.PaidAt,
        i.CreatedAt);
}
