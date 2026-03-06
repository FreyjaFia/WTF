using WTF.Domain.Entities;

namespace WTF.Api.Common.Orders;

public static class OrderMetrics
{
    public static decimal ComputeOrderTotal(
        Order order,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        var regularTotal = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
            .Sum(parent => ComputeParentItemTotal(
                parent,
                order.OrderItems.Where(child => child.ParentOrderItemId == parent.Id && child.BundlePromotionId == null),
                addOnOverridePrices));

        var bundleTotal = order.OrderBundlePromotions.Sum(bundle => bundle.UnitPrice * bundle.Quantity);
        return regularTotal + bundleTotal;
    }

    public static decimal ComputeParentItemTotal(
        OrderItem parentItem,
        IEnumerable<OrderItem> addOnItems,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        var parentUnitPrice = parentItem.Price ?? parentItem.Product.Price;
        var addOnPerUnit = addOnItems.Sum(child =>
        {
            var childUnitPrice = child.Price
                ?? (addOnOverridePrices.TryGetValue((parentItem.ProductId, child.ProductId), out var overridePrice)
                    ? overridePrice
                    : child.Product.Price);

            return childUnitPrice * child.Quantity;
        });

        return (parentUnitPrice + addOnPerUnit) * parentItem.Quantity;
    }
}
