using WTF.Api.Common.Orders;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Calculations;

public class AddOnPriceLookupTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _burger = Guid.NewGuid();
    private readonly Guid _cheese = Guid.NewGuid();
    private readonly Guid _bacon = Guid.NewGuid();

    private async Task SeedOverrides()
    {
        await using var db = TestDb.Create(_dbName);
        db.ProductAddOnPriceOverrides.AddRange(
            new ProductAddOnPriceOverride { Id = Guid.NewGuid(), ProductId = _burger, AddOnId = _cheese, Price = 5m, IsActive = true },
            new ProductAddOnPriceOverride { Id = Guid.NewGuid(), ProductId = _burger, AddOnId = _bacon, Price = 9m, IsActive = false });
        await db.SaveChangesAsync();
    }

    private Order OrderWithAddOns(params Guid[] addOnIds)
    {
        var order = new Order { Id = Guid.NewGuid() };
        var parent = new OrderItem { Id = Guid.NewGuid(), OrderId = order.Id, ProductId = _burger, Quantity = 1 };
        order.OrderItems.Add(parent);
        foreach (var addOnId in addOnIds)
        {
            var child = new OrderItem
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                ProductId = addOnId,
                Quantity = 1,
                ParentOrderItemId = parent.Id,
            };
            order.OrderItems.Add(child);
            parent.InverseParentOrderItem.Add(child);
        }

        return order;
    }

    [Fact]
    public async Task ForOrders_ReturnsOnlyActiveOverridesForTheOrderPairs()
    {
        await SeedOverrides();
        await using var db = TestDb.Create(_dbName);

        var prices = await AddOnPriceLookup.ForOrdersAsync(db, [OrderWithAddOns(_cheese, _bacon)], default);

        prices.Count.ShouldBe(1);
        prices[(_burger, _cheese)].ShouldBe(5m);
    }

    [Fact]
    public async Task ForOrders_NoAddOns_ReturnsEmpty()
    {
        await SeedOverrides();
        await using var db = TestDb.Create(_dbName);

        var prices = await AddOnPriceLookup.ForOrdersAsync(db, [OrderWithAddOns()], default);

        prices.ShouldBeEmpty();
    }

    [Fact]
    public async Task ForParentItems_ReadsAddOnsFromTheLoadedChildren()
    {
        await SeedOverrides();
        await using var db = TestDb.Create(_dbName);
        var order = OrderWithAddOns(_cheese);
        var parents = order.OrderItems.Where(oi => oi.ParentOrderItemId == null);

        var prices = await AddOnPriceLookup.ForParentItemsAsync(db, parents, default);

        prices.Count.ShouldBe(1);
        prices[(_burger, _cheese)].ShouldBe(5m);
    }
}
