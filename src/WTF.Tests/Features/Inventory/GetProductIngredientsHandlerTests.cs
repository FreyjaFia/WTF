using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class GetProductIngredientsHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly OrderSeed _data;

    public GetProductIngredientsHandlerTests()
    {
        _data = new OrderSeed(_db);
    }

    private Task<ProductIngredientsDto> Run(bool includeCosts = true) =>
        new GetProductIngredientsHandler(TestDb.Create(_db)).Handle(new GetProductIngredientsQuery(includeCosts), CancellationToken.None);

    [Fact]
    public async Task AProductWithIngredients_ShowsItsCountCostAndMargin()
    {
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m), 200m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Cup", 50m, cost: 4m), 1m);

        var result = await Run();

        var row = result.Products.Single();
        row.IngredientCount.ShouldBe(2);
        row.Cost.ShouldBe(34m);
        row.Margin.ShouldBe(116m);
        row.MarginPercent.ShouldBe(77.33m);
        row.Status.ShouldBe("Covered");
        result.Ready.ShouldBe(1);
        result.ShowsCosts.ShouldBeTrue();
    }

    [Fact]
    public async Task AProductWithNothingSetUp_HasNoCostInsteadOfAFreeOne()
    {
        _data.AddProduct("Water", 20m);

        var result = await Run();

        var row = result.Products.Single();
        row.IngredientCount.ShouldBe(0);
        row.Cost.ShouldBeNull();
        row.Margin.ShouldBeNull();
        row.Status.ShouldBe("Missing");
        result.Missing.ShouldBe(1);
    }

    [Fact]
    public async Task AnIngredientWithNoCostYet_IsCountedAsUnknown()
    {
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 1000m), 200m);

        var row = (await Run()).Products.Single();

        row.UnknownCostCount.ShouldBe(1);
    }

    [Fact]
    public async Task WithoutCostAccess_NoCostOrMarginIsReturned()
    {
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m), 200m);

        var result = await Run(includeCosts: false);

        var row = result.Products.Single();
        row.IngredientCount.ShouldBe(1);
        row.Cost.ShouldBeNull();
        row.Margin.ShouldBeNull();
        row.MarginPercent.ShouldBeNull();
        result.ShowsCosts.ShouldBeFalse();
    }

    [Fact]
    public async Task OnlySuppliesAndNoIngredients_CountsTheSuppliesAsTheCost()
    {
        var water = _data.AddProduct("Water", 20m);
        SetSupplies(water, 1.5m);

        var row = (await Run()).Products.Single();

        row.Cost.ShouldBe(1.5m);
        row.Margin.ShouldBe(18.5m);
    }

    private void SetSupplies(Guid productId, decimal amount)
    {
        using var db = TestDb.Create(_db);
        db.Products.Single(p => p.Id == productId).SuppliesCost = amount;
        db.SaveChanges();
    }
}
