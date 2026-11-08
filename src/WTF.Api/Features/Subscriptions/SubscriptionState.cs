using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Features.Subscriptions;

public sealed record SubscriptionState(
    int PlanId,
    string PlanCode,
    string PlanName,
    decimal MonthlyPrice,
    string[] Features,
    int? MaxUsers,
    DateTime PeriodStart,
    DateTime PeriodEnd,
    int GraceDays,
    decimal DiscountPercent,
    DateTime AccessUntil,
    SubscriptionWarning Warning,
    int DaysLeft)
{
    public bool IsLocked => Warning == SubscriptionWarning.Locked;
}

public static class SubscriptionStateLoader
{
    public static async Task<SubscriptionState?> LoadAsync(WTFDbContext db, Guid tenantId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var row = await db.TenantSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new
            {
                s.PlanId,
                s.Plan.Code,
                s.Plan.Name,
                s.Plan.MonthlyPrice,
                s.Plan.Features,
                s.Plan.MaxUsers,
                s.CurrentPeriodStart,
                s.CurrentPeriodEnd,
                s.GraceDays,
                s.DiscountPercent
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null)
        {
            return null;
        }

        return new SubscriptionState(
            row.PlanId,
            row.Code,
            row.Name,
            row.MonthlyPrice,
            SplitFeatures(row.Features),
            row.MaxUsers,
            row.CurrentPeriodStart,
            row.CurrentPeriodEnd,
            row.GraceDays,
            row.DiscountPercent,
            SubscriptionRules.AccessUntil(row.CurrentPeriodEnd, row.GraceDays),
            SubscriptionRules.WarningLevel(row.CurrentPeriodEnd, row.GraceDays, nowUtc),
            SubscriptionRules.DaysLeft(row.CurrentPeriodEnd, nowUtc));
    }

    // Only the shop's own tenant is ever locked by its subscription; code without a tenant (Single mode) is never locked.
    public static async Task<bool> IsLockedAsync(WTFDbContext db, Guid tenantId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var row = await db.TenantSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.CurrentPeriodEnd, s.GraceDays })
            .FirstOrDefaultAsync(cancellationToken);

        return row is not null && !SubscriptionRules.AllowsAccess(row.CurrentPeriodEnd, row.GraceDays, nowUtc);
    }

    public static string[] SplitFeatures(string features) =>
        features.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
