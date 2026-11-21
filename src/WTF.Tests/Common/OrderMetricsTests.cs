using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Tests.Common;

public class OrderMetricsTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private static Product Prod(decimal price) => new() { Id = Guid.NewGuid(), Price = price };

    private static OrderItem Line(Product p, int qty, decimal? price = null, OrderItem? parent = null, Guid? bundleId = null) =>
        new()
        {
            Id = Guid.NewGuid(),
            ProductId = p.Id,
            Product = p,
            Quantity = qty,
            Price = price,
            ParentOrderItemId = parent?.Id,
            BundlePromotionId = bundleId
        };

    [Fact]
    public void ComputeParentItemTotal_UsesProductPriceWhenNoSnapshotPrice()
    {
        var parent = Line(Prod(100m), 2);

        OrderMetrics.ComputeParentItemTotal(parent, [], NoOverrides).ShouldBe(200m);
    }

    [Fact]
    public void ComputeParentItemTotal_PrefersSnapshotPrice()
    {
        var parent = Line(Prod(100m), 2, price: 80m);

        OrderMetrics.ComputeParentItemTotal(parent, [], NoOverrides).ShouldBe(160m);
    }

    [Fact]
    public void ComputeParentItemTotal_AddOnsMultipliedByParentQuantity()
    {
        var parent = Line(Prod(100m), 3);
        var addOn = Line(Prod(10m), 2, parent: parent);

        OrderMetrics.ComputeParentItemTotal(parent, [addOn], NoOverrides).ShouldBe((100m + 20m) * 3);
    }

    [Fact]
    public void ComputeParentItemTotal_AddOnOverrideUsedWhenNoSnapshot()
    {
        var parent = Line(Prod(100m), 1);
        var addOn = Line(Prod(10m), 1, parent: parent);
        var overrides = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>
        {
            [(parent.ProductId, addOn.ProductId)] = 4m
        };

        OrderMetrics.ComputeParentItemTotal(parent, [addOn], overrides).ShouldBe(104m);
    }

    [Fact]
    public void ComputeParentItemTotal_AddOnSnapshotBeatsOverride()
    {
        var parent = Line(Prod(100m), 1);
        var addOn = Line(Prod(10m), 1, price: 7m, parent: parent);
        var overrides = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>
        {
            [(parent.ProductId, addOn.ProductId)] = 4m
        };

        OrderMetrics.ComputeParentItemTotal(parent, [addOn], overrides).ShouldBe(107m);
    }

    [Fact]
    public void ComputeOrderTotal_SumsParentsAddOnsAndBundles_IgnoringBundleLines()
    {
        var coffee = Line(Prod(100m), 2);
        var shot = Line(Prod(15m), 1, parent: coffee);
        var bundleLine = Line(Prod(999m), 1, bundleId: Guid.NewGuid());
        var order = new Order
        {
            OrderItems = [coffee, shot, bundleLine],
            OrderBundlePromotions = [new OrderBundlePromotion { UnitPrice = 250m, Quantity = 2 }]
        };

        // (100 + 15) * 2 + 250 * 2
        OrderMetrics.ComputeOrderTotal(order, NoOverrides).ShouldBe(730m);
    }

    [Fact]
    public void ComputeOrderTotal_EmptyOrder_IsZero()
    {
        OrderMetrics.ComputeOrderTotal(new Order(), NoOverrides).ShouldBe(0m);
    }

    [Fact]
    public void ListPrice_UsesTheBranchPriceOfTheOrderWhenItHasOne_ElseTheShopPrice()
    {
        var latte = Prod(160m);
        var syrup = Prod(10m);
        var parent = Line(latte, 2);
        var addOn = Line(syrup, 1, parent: parent);
        var order = new Order { Id = Guid.NewGuid(), BranchPrices = new Dictionary<Guid, decimal> { [latte.Id] = 175m } };
        parent.Order = order;
        addOn.Order = order;
        order.OrderItems.Add(parent);
        order.OrderItems.Add(addOn);

        OrderMetrics.ListPrice(parent).ShouldBe(175m);
        OrderMetrics.ListPrice(addOn).ShouldBe(10m);
        OrderMetrics.ComputeOrderTotal(order, NoOverrides).ShouldBe(370m);
    }

    [Fact]
    public void ListPrice_OfAnItemWithNoOrder_IsTheShopPrice()
    {
        OrderMetrics.ListPrice(Line(Prod(160m), 1)).ShouldBe(160m);
    }

    [Fact]
    public void ASavedLinePrice_IsNeverChangedByABranchPrice()
    {
        var latte = Prod(160m);
        var parent = Line(latte, 1, price: 150m);
        var order = new Order { Id = Guid.NewGuid(), BranchPrices = new Dictionary<Guid, decimal> { [latte.Id] = 175m } };
        parent.Order = order;
        order.OrderItems.Add(parent);

        OrderMetrics.ComputeOrderTotal(order, NoOverrides).ShouldBe(150m);
    }
}
