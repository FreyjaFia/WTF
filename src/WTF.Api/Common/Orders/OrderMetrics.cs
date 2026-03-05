using WTF.Domain.Entities;

namespace WTF.Api.Common.Orders;

public static class OrderMetrics
{
    public static decimal ComputeOrderTotal(Order order)
    {
        var regularTotal = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
            .Sum(parent =>
            {
                var parentUnitPrice = parent.Price ?? parent.Product.Price;
                var addOnPerUnit = order.OrderItems
                    .Where(child => child.ParentOrderItemId == parent.Id && child.BundlePromotionId == null)
                    .Sum(child => (child.Price ?? child.Product.Price) * child.Quantity);

                return (parentUnitPrice + addOnPerUnit) * parent.Quantity;
            });

        var bundleTotal = order.OrderBundlePromotions.Sum(bundle => bundle.UnitPrice * bundle.Quantity);
        return regularTotal + bundleTotal;
    }
}
