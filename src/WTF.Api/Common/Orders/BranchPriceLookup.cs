using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Common.Orders;

// The one place that reads a branch's own prices (ProductBranchPrices). A product with no row in a branch costs its shop price.
public static class BranchPriceLookup
{
    public static async Task<Guid> BranchForNewOrderAsync(WTFDbContext db, Guid? requestedBranchId, CancellationToken cancellationToken)
    {
        if (requestedBranchId is { } requested && requested != Guid.Empty)
        {
            return requested;
        }

        if (db.ActiveBranchId is { } active)
        {
            return active;
        }

        return await db.Branches.IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(b => b.IsMain)
            .Select(b => b.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    // Branch prices count only while the plan holds the branches feature, like the rest of the branch rules. A finished order is
    // priced from what it was saved with (StampAsync), so a plan change never moves an old total.
    public static async Task<Dictionary<Guid, decimal>> ForBranchAsync(
        WTFDbContext db,
        ITenantFeatures tenantFeatures,
        Guid branchId,
        IReadOnlyCollection<Guid>? productIds,
        CancellationToken cancellationToken)
    {
        if (branchId == Guid.Empty || !await tenantFeatures.HasFeatureAsync(db, PlanFeatures.Branches, cancellationToken))
        {
            return [];
        }

        return await LoadAsync(db, branchId, productIds, cancellationToken);
    }

    private static async Task<Dictionary<Guid, decimal>> LoadAsync(
        WTFDbContext db,
        Guid branchId,
        IReadOnlyCollection<Guid>? productIds,
        CancellationToken cancellationToken)
    {
        if (branchId == Guid.Empty)
        {
            return [];
        }

        // The price of a branch is read for orders and catalogs of that branch, whichever branches the person may see.
        var query = db.ProductBranchPrices.IgnoreQueryFilters([WTFDbContext.BranchFilterName]).AsNoTracking().Where(p => p.BranchId == branchId);
        if (productIds is not null)
        {
            query = query.Where(p => productIds.Contains(p.ProductId));
        }

        return await query.ToDictionaryAsync(p => p.ProductId, p => p.Price, cancellationToken);
    }

    public static async Task StampAsync(WTFDbContext db, IEnumerable<Order> orders, CancellationToken cancellationToken)
    {
        foreach (var group in orders.Where(o => o.BranchPrices is null).GroupBy(o => o.BranchId))
        {
            var prices = await LoadAsync(db, group.Key, null, cancellationToken);
            foreach (var order in group)
            {
                order.BranchPrices = prices;
            }
        }
    }

    public static decimal PriceFor(IReadOnlyDictionary<Guid, decimal> branchPrices, Guid productId, decimal shopPrice) =>
        branchPrices.TryGetValue(productId, out var price) ? price : shopPrice;
}
