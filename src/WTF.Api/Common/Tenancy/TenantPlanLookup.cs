using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public static class TenantPlanLookup
{
    // No subscription row means a single-shop install from before the tenants script: it keeps every feature.
    public static async Task<TenantPlan> LoadAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var plan = await db.TenantSubscriptions
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Plan.Name, s.Plan.Features })
            .FirstOrDefaultAsync(cancellationToken);

        return plan is null ? new TenantPlan(string.Empty, PlanFeatures.All()) : new TenantPlan(plan.Name, PlanFeatures.Parse(plan.Features));
    }

    // Straight from the database, for jobs and tests. A request with no shop (tests, platform area) is never blocked.
    public static async Task<bool> HasFeatureAsync(WTFDbContext db, string feature, CancellationToken cancellationToken)
    {
        return db.StampTenantId is not { } tenantId || (await LoadAsync(db, tenantId, cancellationToken)).Features.Contains(feature);
    }

    public static async Task<bool> HasFeatureAsync(this ITenantFeatures features, WTFDbContext db, string feature, CancellationToken cancellationToken)
    {
        return db.StampTenantId is not { } tenantId || (await features.GetAsync(db, tenantId, cancellationToken)).Features.Contains(feature);
    }
}
