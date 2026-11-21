using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Calculations.Catalog;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;

namespace WTF.Api.Common.Orders;

// The one place that reads "Sold at" (ProductBranches). A product with no row is sold at every branch. The rows count only
// while the plan holds the branches feature; without it every product is sold everywhere, as before branches existed.
public static class ProductBranchLookup
{
    public static async Task<Dictionary<Guid, List<Guid>>> SoldAtAsync(
        WTFDbContext db,
        IReadOnlyCollection<Guid>? productIds,
        CancellationToken cancellationToken)
    {
        var query = db.ProductBranches.AsNoTracking();
        if (productIds is not null)
        {
            query = query.Where(p => productIds.Contains(p.ProductId));
        }

        var rows = await query.Select(p => new { p.ProductId, p.BranchId }).ToListAsync(cancellationToken);
        return rows.GroupBy(r => r.ProductId).ToDictionary(g => g.Key, g => g.Select(r => r.BranchId).ToList());
    }

    public static async Task<HashSet<Guid>> NotSoldAtAsync(
        WTFDbContext db,
        ITenantFeatures tenantFeatures,
        Guid branchId,
        CancellationToken cancellationToken)
    {
        if (branchId == Guid.Empty || !await tenantFeatures.HasFeatureAsync(db, PlanFeatures.Branches, cancellationToken))
        {
            return [];
        }

        var soldAt = await SoldAtAsync(db, null, cancellationToken);
        return [.. soldAt.Where(p => !ProductAvailability.IsSoldAt(p.Value, branchId)).Select(p => p.Key)];
    }
}
