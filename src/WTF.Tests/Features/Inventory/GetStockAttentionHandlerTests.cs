using WTF.Api.Features.Inventory;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class GetStockAttentionHandlerTests
{
    private readonly string _db = TestDb.NewName();

    private Task<WTF.Api.Features.Inventory.DTOs.StockAttentionDto> Run() =>
        new GetStockAttentionHandler(TestDb.Create(_db)).Handle(new GetStockAttentionQuery(), CancellationToken.None);

    [Fact]
    public async Task ListsOnlyItemsThatAreLow_WorstFirst_WithCounts()
    {
        StockSeed.Item(_db, "Fine", 900m, warning: 500m, critical: 200m);
        StockSeed.Item(_db, "Warning", 400m, warning: 500m, critical: 200m);
        StockSeed.Item(_db, "Critical", 150m, warning: 500m, critical: 200m);
        StockSeed.Item(_db, "Out", 0m, warning: 500m, critical: 200m);
        StockSeed.Item(_db, "Below zero", -20m, warning: 500m, critical: 200m);

        var result = await Run();

        result.Items.Select(i => i.Name).ShouldBe(["Below zero", "Out", "Critical", "Warning"]);
        result.Items.Select(i => i.Status).ShouldBe(["OutOfStock", "OutOfStock", "Critical", "Warning"]);
        result.OutCount.ShouldBe(2);
        result.CriticalCount.ShouldBe(1);
        result.WarningCount.ShouldBe(1);
        result.TotalCount.ShouldBe(4);
    }

    [Fact]
    public async Task IgnoresInactiveItems_AndItemsWithNoLevelsThatHaveStock()
    {
        StockSeed.Item(_db, "Old", 0m, active: false);
        StockSeed.Item(_db, "No levels", 50m);

        var result = await Run();

        result.Items.ShouldBeEmpty();
        result.TotalCount.ShouldBe(0);
    }

    [Fact]
    public async Task ShowsHowManyProductsDependOnTheItem_AndHowManySalesItStillCovers()
    {
        var data = new OrderSeed(_db);
        var milk = StockSeed.Item(_db, "Milk", 450m, warning: 500m, critical: 200m);
        var latte = data.AddProduct("Latte", 150m);
        var mocha = data.AddProduct("Mocha", 160m);
        StockSeed.Link(_db, latte, milk, 200m);
        StockSeed.Link(_db, mocha, milk, 150m);
        StockSeed.Link(_db, data.AddProduct("Old", 10m), milk, 1m, active: false);

        var item = (await Run()).Items.Single();

        item.ProductCount.ShouldBe(2);
        item.SalesCovered.ShouldBe(2);
        item.UnitName.ShouldBe("ml");
    }

    [Fact]
    public async Task LinksOfDeletedProducts_AreNotCounted()
    {
        var data = new OrderSeed(_db);
        var milk = StockSeed.Item(_db, "Milk", 450m, warning: 500m, critical: 200m);
        StockSeed.Link(_db, data.AddProduct("Latte", 150m), milk, 200m);
        StockSeed.Link(_db, data.AddProduct("Retired", 160m, isActive: false), milk, 50m);

        var item = (await Run()).Items.Single();

        item.ProductCount.ShouldBe(1);
        item.SalesCovered.ShouldBe(2);
    }

    [Fact]
    public async Task AnItemNoProductUses_CoversNoSales_ButStillShows()
    {
        StockSeed.Item(_db, "Spare", 10m, warning: 50m);

        var item = (await Run()).Items.Single();

        item.ProductCount.ShouldBe(0);
        item.SalesCovered.ShouldBe(0);
    }
}
