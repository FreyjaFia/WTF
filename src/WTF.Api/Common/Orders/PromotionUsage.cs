using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Sales;
using WTF.Domain.Data;

namespace WTF.Api.Common.Orders;

internal static class PromotionUsage
{
    // A voided order gives its uses back; an order waiting for approval or review still holds them.
    private static readonly int[] CountedStatuses =
    [
        OrderStatuses.Pending,
        OrderStatuses.Completed,
        OrderStatuses.PendingApproval,
        OrderStatuses.PendingReview,
    ];

    // A bundle is used as many times as it was sold; a discount as many times as it priced an item.
    public static async Task<Dictionary<Guid, int>> CountAsync(
        WTFDbContext db,
        IReadOnlyCollection<Guid> promotionIds,
        Guid? exceptOrderId,
        CancellationToken cancellationToken)
    {
        var used = promotionIds.Distinct().ToDictionary(id => id, _ => 0);
        if (used.Count == 0)
        {
            return used;
        }

        var ids = used.Keys.ToList();

        var bundles = await db.OrderBundlePromotions
            .Where(b => ids.Contains(b.PromotionId)
                && CountedStatuses.Contains(b.Order.StatusId)
                && (exceptOrderId == null || b.OrderId != exceptOrderId))
            .GroupBy(b => b.PromotionId)
            .Select(g => new { Id = g.Key, Count = g.Sum(b => b.Quantity) })
            .ToListAsync(cancellationToken);

        var discounts = await db.OrderItems
            .Where(i => i.DiscountPromotionId != null
                && ids.Contains(i.DiscountPromotionId.Value)
                && i.ParentOrderItemId == null
                && CountedStatuses.Contains(i.Order.StatusId)
                && (exceptOrderId == null || i.OrderId != exceptOrderId))
            .GroupBy(i => i.DiscountPromotionId!.Value)
            .Select(g => new { Id = g.Key, Count = g.Sum(i => i.Quantity) })
            .ToListAsync(cancellationToken);

        foreach (var row in bundles.Concat(discounts))
        {
            used[row.Id] += row.Count;
        }

        return used;
    }
}
