using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Common.Orders;

internal static class PendingOrderPreview
{
    // An order that is not completed yet saves no prices; they are fixed when it completes. This works out the discounted
    // unit price each of its plain lines would get with the promotions that are on right now, so a list shows the same
    // total as the cart. Keyed by order line id; lines that get no discount are left out.
    public static async Task<IReadOnlyDictionary<Guid, decimal>> LoadAsync(
        WTFDbContext db,
        IEnumerable<Order> orders,
        IHttpContextAccessor? httpContextAccessor,
        CancellationToken cancellationToken)
    {
        var unpriced = orders
            .Where(o => o.StatusId is (int)OrderStatusEnum.Pending or (int)OrderStatusEnum.PendingApproval)
            .ToList();
        if (unpriced.Count == 0)
        {
            return new Dictionary<Guid, decimal>();
        }

        var timeZone = httpContextAccessor is null
            ? TimeZoneInfo.Utc
            : RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var loaded = await DiscountRuleLoader.LoadAsync(db, DateTime.UtcNow, timeZone, null, cancellationToken);

        var prices = new Dictionary<Guid, decimal>();
        if (loaded.RulesByProductId.Count == 0)
        {
            return prices;
        }

        foreach (var order in unpriced)
        {
            // Each order is judged on its own. Uses it already holds (reserved when it was saved) are not gone for it, so give
            // them back; uses held by other orders stay taken.
            var budget = loaded.Budget.Clone();
            foreach (var held in order.OrderItems.Where(oi => oi.ParentOrderItemId == null && oi.DiscountPromotionId != null))
            {
                budget.Return(held.DiscountPromotionId, held.Quantity);
            }

            foreach (var parent in order.OrderItems
                .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null && oi.Price == null))
            {
                var addOns = order.OrderItems
                    .Where(child => child.ParentOrderItemId == parent.Id)
                    .Select(child => (child.ProductId, child.Quantity));

                var applied = PromotionPricing.GetDiscountedUnitPrice(
                    parent.Product.Price, parent.ProductId, addOns, loaded.RulesByProductId, parent.Quantity, budget);
                if (applied is null)
                {
                    continue;
                }

                budget.Use(applied.PromotionId, parent.Quantity);
                prices[parent.Id] = applied.Price;
            }
        }

        return prices;
    }
}
