using WTF.Api.Common.Tenancy;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Orders;

internal static class PromotionsGate
{
    public static Task<bool> IsOnAsync(WTFDbContext db, ITenantFeatures tenantFeatures, CancellationToken cancellationToken) =>
        tenantFeatures.HasFeatureAsync(db, PlanFeatures.Promotions, cancellationToken);
}
