using WTF.Api.Features.Inventory;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class GetPosStockLimitsHandlerTests
{
    private readonly string _db = TestDb.NewName();

    private Task<WTF.Api.Features.Inventory.DTOs.PosStockLimitsDto> Run() =>
        new GetPosStockLimitsHandler(TestDb.Create(_db)).Handle(new GetPosStockLimitsQuery(), CancellationToken.None);

    [Fact]
    public async Task ListsOnlyActiveItemsThatBlockSales_WithTheirBalances()
    {
        StockSeed.Item(_db, "Cup", 12m, allowNegative: false);
        StockSeed.Item(_db, "Oat Milk", 900m, allowNegative: true);
        StockSeed.Item(_db, "Old Lid", 4m, allowNegative: false, active: false);

        var result = await Run();

        var item = result.Items.Single();
        item.Name.ShouldBe("Cup");
        item.Balance.ShouldBe(12m);
        item.UnitName.ShouldBe("ml");
    }

    [Fact]
    public async Task ListsTheActiveLinksToThoseItemsOnly()
    {
        var data = new OrderSeed(_db);
        var cup = StockSeed.Item(_db, "Cup", 1m, allowNegative: false);
        var milk = StockSeed.Item(_db, "Oat Milk", 900m);
        var mocha = data.AddProduct("Mocha", 160m);
        var latte = data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, mocha, cup, 1m);
        StockSeed.Link(_db, latte, cup, 2m, active: false);
        StockSeed.Link(_db, latte, milk, 200m);

        var result = await Run();

        var link = result.Links.Single();
        link.ProductId.ShouldBe(mocha);
        link.ItemId.ShouldBe(cup);
        link.QuantityPerSale.ShouldBe(1m);
    }

    [Fact]
    public async Task WithNothingBlocking_ReturnsEmptyLists()
    {
        StockSeed.Item(_db, "Oat Milk", 900m, allowNegative: true);

        var result = await Run();

        result.Items.ShouldBeEmpty();
        result.Links.ShouldBeEmpty();
        result.AsOf.ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task ShowsANegativeBalanceAsIs_SoTheRegisterCanBlock()
    {
        StockSeed.Item(_db, "Cup", -2m, allowNegative: false);

        (await Run()).Items.Single().Balance.ShouldBe(-2m);
    }
}
