using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class SalesRulesRefundTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private static Order OrderOf(int statusId, decimal amount)
    {
        var product = new Product { Id = Guid.NewGuid(), Price = amount };
        var order = new Order { Id = Guid.NewGuid(), StatusId = statusId };
        order.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            ProductId = product.Id,
            Product = product,
            Quantity = 1,
            Price = amount,
        });
        return order;
    }

    [Fact]
    public void Summarize_CountsRefundedOrdersAndTheirValue_OutsideRevenue()
    {
        var summary = SalesRules.Summarize(
            [
                OrderOf(OrderStatuses.Completed, 300m),
                OrderOf(OrderStatuses.Refunded, 120m),
                OrderOf(OrderStatuses.Refunded, 30m),
                OrderOf(OrderStatuses.Cancelled, 900m),
            ],
            NoOverrides);

        summary.RefundedOrderCount.ShouldBe(2);
        summary.RefundedAmount.ShouldBe(150m);
        summary.Revenue.ShouldBe(300m);
        summary.VoidedOrderCount.ShouldBe(3);
        summary.GrossSales.ShouldBe(450m);
        summary.NetSales.ShouldBe(300m);
    }

    [Fact]
    public void Summarize_NoRefunds_GrossEqualsNet()
    {
        var summary = SalesRules.Summarize([OrderOf(OrderStatuses.Completed, 80m)], NoOverrides);

        summary.RefundedOrderCount.ShouldBe(0);
        summary.RefundedAmount.ShouldBe(0m);
        summary.GrossSales.ShouldBe(80m);
        summary.NetSales.ShouldBe(80m);
    }

    [Theory]
    [InlineData(1, 4, 25)]
    [InlineData(0, 4, 0)]
    [InlineData(4, 4, 100)]
    [InlineData(3, 0, 0)]
    public void VoidRate_IsVoidedShareOfAllOrders(int voided, int total, int expected) =>
        SalesRules.VoidRate(voided, total).ShouldBe(expected);

    [Fact]
    public void AddOnPrices_UseOwnPriceThenOverrideThenCatalog()
    {
        var parentProduct = new Product { Id = Guid.NewGuid(), Price = 100m };
        var addOnProduct = new Product { Id = Guid.NewGuid(), Price = 10m };
        var parent = new OrderItem { Id = Guid.NewGuid(), ProductId = parentProduct.Id, Product = parentProduct, Quantity = 3, Price = 100m };
        var addOn = new OrderItem { Id = Guid.NewGuid(), ProductId = addOnProduct.Id, Product = addOnProduct, Quantity = 2 };
        var overrides = new Dictionary<(Guid ProductId, Guid AddOnId), decimal> { [(parentProduct.Id, addOnProduct.Id)] = 15m };

        OrderMetrics.AddOnUnitPrice(parent, addOn, NoOverrides).ShouldBe(10m);
        OrderMetrics.AddOnUnitPrice(parent, addOn, overrides).ShouldBe(15m);

        addOn.Price = 20m;
        OrderMetrics.AddOnUnitPrice(parent, addOn, overrides).ShouldBe(20m);
        // unit price x add-on quantity x parent quantity
        OrderMetrics.ComputeAddOnTotal(parent, addOn, overrides).ShouldBe(120m);
    }

    [Fact]
    public void ParentTotal_EqualsParentPlusEveryAddOnTotal()
    {
        var parentProduct = new Product { Id = Guid.NewGuid(), Price = 100m };
        var addOnProduct = new Product { Id = Guid.NewGuid(), Price = 10m };
        var parent = new OrderItem { Id = Guid.NewGuid(), ProductId = parentProduct.Id, Product = parentProduct, Quantity = 3, Price = 100m };
        var addOn = new OrderItem { Id = Guid.NewGuid(), ProductId = addOnProduct.Id, Product = addOnProduct, Quantity = 2 };

        var total = OrderMetrics.ComputeParentItemTotal(parent, [addOn], NoOverrides);

        total.ShouldBe(300m + OrderMetrics.ComputeAddOnTotal(parent, addOn, NoOverrides));
    }
}
