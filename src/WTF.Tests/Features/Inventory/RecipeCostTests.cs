using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class RecipeCostTests
{
    private readonly string _db = TestDb.NewName();
    private readonly OrderSeed _data;

    public RecipeCostTests()
    {
        _data = new OrderSeed(_db);
    }

    private Task<WTF.Api.Features.Inventory.DTOs.RecipeCostDto?> Cost(Guid productId) =>
        new GetProductRecipeCostHandler(TestDb.Create(_db)).Handle(new GetProductRecipeCostQuery(productId), CancellationToken.None);

    [Fact]
    public async Task MissingProduct_ReturnsNull()
    {
        (await Cost(Guid.NewGuid())).ShouldBeNull();
    }

    [Fact]
    public async Task AddsEachLineAtItsEffectiveQuantityAndUsableCost()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m);
        var cup = StockSeed.Item(_db, "Cup", 50m, cost: 4m);
        StockSeed.Link(_db, latte, milk, 200m, allowancePercent: 5m);
        StockSeed.Link(_db, latte, cup, 1m);

        var result = (await Cost(latte))!;

        var milkLine = result.Lines.Single(l => l.ItemName == "Milk");
        milkLine.EffectiveQuantity.ShouldBe(210m);
        milkLine.UnitCost.ShouldBe(0.15m);
        milkLine.LineCost.ShouldBe(31.5m);
        result.TotalCost.ShouldBe(35.5m);
        result.Margin.ShouldBe(114.5m);
        result.MarginPercent.ShouldBe(76.33m);
        result.UnknownCostCount.ShouldBe(0);
    }

    [Fact]
    public async Task UsableShareRaisesTheCostOfAUnit()
    {
        var salad = _data.AddProduct("Salad", 100m);
        var fruit = StockSeed.Item(_db, "Mango", 1000m, averageCost: 0.10m, yieldPercent: 80m);
        StockSeed.Link(_db, salad, fruit, 100m);

        var result = (await Cost(salad))!;

        result.Lines.Single().UnitCost.ShouldBe(0.125m);
        result.TotalCost.ShouldBe(12.5m);
    }

    [Fact]
    public async Task AnItemWithNoCost_IsCountedAsUnknownNotFree()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m);
        var syrup = StockSeed.Item(_db, "Syrup", 500m);
        StockSeed.Link(_db, latte, milk, 200m);
        StockSeed.Link(_db, latte, syrup, 20m);

        var result = (await Cost(latte))!;

        result.UnknownCostCount.ShouldBe(1);
        result.Lines.Single(l => l.ItemName == "Syrup").UnitCost.ShouldBeNull();
        result.Lines.Single(l => l.ItemName == "Syrup").LineCost.ShouldBeNull();
        result.TotalCost.ShouldBe(30m);
    }

    [Fact]
    public async Task IgnoresSwitchedOffLinksAndInactiveItems()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m);
        var oldCup = StockSeed.Item(_db, "Old Cup", 5m, cost: 9m, active: false);
        var lid = StockSeed.Item(_db, "Lid", 5m, cost: 1m);
        StockSeed.Link(_db, latte, milk, 200m);
        StockSeed.Link(_db, latte, oldCup, 1m);
        StockSeed.Link(_db, latte, lid, 1m, active: false);

        var result = (await Cost(latte))!;

        result.Lines.Single().ItemName.ShouldBe("Milk");
    }

    [Fact]
    public async Task ARecipeWithNoLinks_HasZeroCostAndFullMargin()
    {
        var water = _data.AddProduct("Water", 20m);

        var result = (await Cost(water))!;

        result.Lines.ShouldBeEmpty();
        result.TotalCost.ShouldBe(0m);
        result.MarginPercent.ShouldBe(100m);
    }

    [Fact]
    public async Task ALossMakingRecipe_HasANegativeMargin()
    {
        var shot = _data.AddProduct("Shot", 10m);
        var beans = StockSeed.Item(_db, "Beans", 1000m, averageCost: 2m);
        StockSeed.Link(_db, shot, beans, 8m);

        var result = (await Cost(shot))!;

        result.TotalCost.ShouldBe(16m);
        result.Margin.ShouldBe(-6m);
        result.MarginPercent.ShouldBe(-60m);
    }

    [Fact]
    public async Task ASaleTakesTheAllowanceOnTopOfTheRecipe()
    {
        var milk = StockSeed.Item(_db, "Milk", 10000m, averageCost: 0.15m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m, allowancePercent: 5m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 2);
        var service = new OrderStockService(TestDb.Create(_db), TestFakes.Audit(), TestFakes.Alerts(TestDb.Create(_db)));

        await service.DeductForOrderAsync(order, Guid.NewGuid(), new StockDeductionOptions(), CancellationToken.None);

        StockSeed.Balance(_db, milk).ShouldBe(9580m);
        var movement = StockSeed.Movements(_db, milk).Single();
        movement.QuantityDelta.ShouldBe(-420m);
        movement.UnitCost.ShouldBe(0.15m);
    }

    [Fact]
    public async Task TheRegisterLimitsUseTheEffectiveQuantity()
    {
        var cup = StockSeed.Item(_db, "Cup", 10m, allowNegative: false);
        var mocha = _data.AddProduct("Mocha", 160m);
        StockSeed.Link(_db, mocha, cup, 2m, allowancePercent: 50m);

        var limits = await new GetPosStockLimitsHandler(TestDb.Create(_db))
            .Handle(new GetPosStockLimitsQuery(), CancellationToken.None);

        limits.Links.Single().QuantityPerSale.ShouldBe(3m);
    }

    [Fact]
    public async Task NeedsAttentionCountsSalesCoveredWithTheAllowance()
    {
        var milk = StockSeed.Item(_db, "Milk", 420m, warning: 500m, critical: 100m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m, allowancePercent: 5m);

        var result = await new GetStockAttentionHandler(TestDb.Create(_db))
            .Handle(new GetStockAttentionQuery(), CancellationToken.None);

        result.Items.Single().SalesCovered.ShouldBe(2);
    }
}
