using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class OrderBreakdownTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private static OrderItem Line(Order order, decimal listPrice, decimal? price, int quantity, decimal? originalPrice = null, OrderItem? parent = null)
    {
        var product = new Product { Id = Guid.NewGuid(), Price = listPrice };
        var item = new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            ProductId = product.Id,
            Product = product,
            Quantity = quantity,
            Price = price,
            OriginalPrice = originalPrice,
            ParentOrderItemId = parent?.Id,
        };
        order.OrderItems.Add(item);
        return item;
    }

    private static Order NewOrder(int status = OrderStatuses.Completed) => new() { Id = Guid.NewGuid(), StatusId = status };

    [Fact]
    public void Discount_IsListPriceMinusChargedPriceTimesQuantity()
    {
        var item = Line(NewOrder(), 100m, 80m, 3, originalPrice: 100m);

        OrderMetrics.ParentItemListUnitPrice(item).ShouldBe(100m);
        OrderMetrics.ParentItemUnitPrice(item).ShouldBe(80m);
        OrderMetrics.ComputeParentItemDiscount(item).ShouldBe(60m);
    }

    [Fact]
    public void Discount_WithoutAnOriginalPrice_IsZero()
    {
        var item = Line(NewOrder(), 100m, 80m, 3);

        OrderMetrics.ComputeParentItemDiscount(item).ShouldBe(0m);
    }

    [Fact]
    public void Discount_NeverNegative_WhenChargedAboveTheOriginalPrice()
    {
        var item = Line(NewOrder(), 100m, 120m, 2, originalPrice: 100m);

        OrderMetrics.ParentItemListUnitPrice(item).ShouldBe(120m);
        OrderMetrics.ComputeParentItemDiscount(item).ShouldBe(0m);
    }

    [Fact]
    public void Discount_FreeItem_IsTheWholeListPrice()
    {
        var item = Line(NewOrder(), 100m, 0m, 2, originalPrice: 100m);

        OrderMetrics.ComputeParentItemDiscount(item).ShouldBe(200m);
    }

    [Fact]
    public void Gross_IsTotalPlusDiscount()
    {
        var order = NewOrder();
        var parent = Line(order, 100m, 80m, 2, originalPrice: 100m);
        var addOn = Line(order, 10m, 10m, 1, parent: parent);

        var gross = OrderMetrics.ComputeParentItemGross(parent, [addOn], NoOverrides);

        gross.ShouldBe(OrderMetrics.ComputeParentItemTotal(parent, [addOn], NoOverrides) + 40m);
        gross.ShouldBe(220m);
    }

    [Fact]
    public void Breakdown_SumsLinesAndAddsBundlesAtTheirOwnPrice()
    {
        var order = NewOrder();
        var parent = Line(order, 100m, 80m, 2, originalPrice: 100m);
        Line(order, 10m, 10m, 1, parent: parent);
        Line(order, 40m, 40m, 1);
        order.OrderBundlePromotions.Add(new OrderBundlePromotion { Id = Guid.NewGuid(), OrderId = order.Id, Quantity = 2, UnitPrice = 30m });

        var breakdown = OrderMetrics.ComputeOrderBreakdown(order, NoOverrides);

        breakdown.Gross.ShouldBe(220m + 40m + 60m);
        breakdown.Discount.ShouldBe(40m);
        breakdown.Net.ShouldBe(breakdown.Gross - breakdown.Discount);
        breakdown.Net.ShouldBe(OrderMetrics.ComputeOrderTotal(order, NoOverrides));
    }

    [Fact]
    public void Breakdown_OfAnEmptyOrder_IsZero()
    {
        var breakdown = OrderMetrics.ComputeOrderBreakdown(NewOrder(), NoOverrides);

        breakdown.Gross.ShouldBe(0m);
        breakdown.Discount.ShouldBe(0m);
        breakdown.Net.ShouldBe(0m);
    }

    [Fact]
    public void Summarize_GrossIsRevenuePlusRefundsPlusDiscounts_AndNetIsRevenue()
    {
        var sold = NewOrder();
        Line(sold, 100m, 80m, 2, originalPrice: 100m);
        var refunded = NewOrder(OrderStatuses.Refunded);
        Line(refunded, 100m, 90m, 1, originalPrice: 100m);
        var cancelled = NewOrder(OrderStatuses.Cancelled);
        Line(cancelled, 100m, 50m, 1, originalPrice: 100m);
        var pending = NewOrder(OrderStatuses.Pending);
        Line(pending, 100m, 50m, 1, originalPrice: 100m);

        var summary = SalesRules.Summarize([sold, refunded, cancelled, pending], NoOverrides);

        summary.Revenue.ShouldBe(160m);
        summary.RefundedAmount.ShouldBe(90m);
        // Only sold and refunded orders count; cancelled and pending ones were never a sale.
        summary.Discounts.ShouldBe(50m);
        summary.GrossSales.ShouldBe(300m);
        summary.NetSales.ShouldBe(160m);
        (summary.GrossSales - summary.Discounts - summary.RefundedAmount).ShouldBe(summary.NetSales);
    }
}
