using WTF.Domain.Entities;

namespace WTF.Calculations.Orders;

public static class OrderMetrics
{
    public static decimal ComputeOrderTotal(
        Order order,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices,
        IReadOnlyDictionary<Guid, decimal>? previewUnitPrices = null)
    {
        var regularTotal = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
            .Sum(parent => ComputeParentItemTotal(
                parent,
                order.OrderItems.Where(child => child.ParentOrderItemId == parent.Id && child.BundlePromotionId == null),
                addOnOverridePrices,
                previewUnitPrices));

        var bundleTotal = order.OrderBundlePromotions.Sum(bundle => bundle.UnitPrice * bundle.Quantity);
        return regularTotal + bundleTotal;
    }

    public static decimal ComputeParentItemTotal(
        OrderItem parentItem,
        IEnumerable<OrderItem> addOnItems,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices,
        IReadOnlyDictionary<Guid, decimal>? previewUnitPrices = null)
    {
        // An order that is not completed yet has no saved price: use the discounted price it would get today, if any.
        var parentUnitPrice = parentItem.Price
            ?? (previewUnitPrices is not null && previewUnitPrices.TryGetValue(parentItem.Id, out var preview) ? preview : parentItem.Product.Price);
        var addOnPerUnit = addOnItems.Sum(child => AddOnUnitPrice(parentItem, child, addOnOverridePrices) * child.Quantity);

        return (parentUnitPrice + addOnPerUnit) * parentItem.Quantity;
    }


    public static decimal ParentItemUnitPrice(OrderItem parentItem) => parentItem.Price ?? parentItem.Product.Price;

    public static decimal ParentItemListUnitPrice(OrderItem parentItem)
    {
        var unit = ParentItemUnitPrice(parentItem);
        return Math.Max(parentItem.OriginalPrice ?? unit, unit);
    }

    public static decimal ComputeParentItemDiscount(OrderItem parentItem) =>
        (ParentItemListUnitPrice(parentItem) - ParentItemUnitPrice(parentItem)) * parentItem.Quantity;

    public static decimal ComputeParentItemGross(
        OrderItem parentItem,
        IEnumerable<OrderItem> addOnItems,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices) =>
        ComputeParentItemTotal(parentItem, addOnItems, addOnOverridePrices) + ComputeParentItemDiscount(parentItem);

    public static OrderBreakdown ComputeOrderBreakdown(
        Order order,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        var gross = 0m;
        var discount = 0m;

        foreach (var parent in order.OrderItems.Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null))
        {
            var addOns = order.OrderItems.Where(child => child.ParentOrderItemId == parent.Id && child.BundlePromotionId == null);
            gross += ComputeParentItemGross(parent, addOns, addOnOverridePrices);
            discount += ComputeParentItemDiscount(parent);
        }

        // A bundle is sold at its own price, so its price is both its gross and its net.
        gross += order.OrderBundlePromotions.Sum(bundle => bundle.UnitPrice * bundle.Quantity);
        return new OrderBreakdown(gross, discount);
    }


    public static decimal AddOnUnitPrice(
        OrderItem parentItem,
        OrderItem addOn,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices) =>
        addOn.Price
        ?? (addOnOverridePrices.TryGetValue((parentItem.ProductId, addOn.ProductId), out var overridePrice)
            ? overridePrice
            : addOn.Product.Price);

    public static decimal ComputeAddOnTotal(
        OrderItem parentItem,
        OrderItem addOn,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices) =>
        AddOnUnitPrice(parentItem, addOn, addOnOverridePrices) * addOn.Quantity * parentItem.Quantity;
}
