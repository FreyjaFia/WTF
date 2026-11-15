using WTF.Api.Common.Tenancy;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Orders;

internal static class PromotionsGate
{
    // The cached plan is used when one is given; code paths that cannot reach the cache read the plan table.
    public static Task<bool> IsOnAsync(WTFDbContext db, ITenantFeatures? tenantFeatures, CancellationToken cancellationToken) =>
        tenantFeatures is null
            ? TenantPlanLookup.HasFeatureAsync(db, PlanFeatures.Promotions, cancellationToken)
            : tenantFeatures.HasFeatureAsync(db, PlanFeatures.Promotions, cancellationToken);
}
