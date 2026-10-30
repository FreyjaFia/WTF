using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Tests.Features.Items;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class SuppliesCostTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private SetSuppliesCostHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    private Task<WTF.Api.Features.Inventory.DTOs.RecipeCostDto?> Cost(Guid productId) =>
        new GetProductRecipeCostHandler(TestDb.Create(_db)).Handle(new GetProductRecipeCostQuery(productId), CancellationToken.None);

    [Fact]
    public async Task SuppliesCost_IsAddedToTheRecipeCost()
    {
        var data = new OrderSeed(_db);
        var latte = data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m);
        StockSeed.Link(_db, latte, milk, 200m);
        await ItemSeed.User(_db, _userId);

        (await Handler().Handle(new SetSuppliesCostCommand(latte, 2.5m), CancellationToken.None)).ShouldBeTrue();

        var cost = (await Cost(latte))!;
        cost.SuppliesCost.ShouldBe(2.5m);
        cost.TotalCost.ShouldBe(32.5m);
        cost.Margin.ShouldBe(117.5m);
    }

    [Fact]
    public async Task SuppliesCost_CountsEvenWithNoRecipeLines()
    {
        var data = new OrderSeed(_db);
        var water = data.AddProduct("Water", 20m);
        await ItemSeed.User(_db, _userId);
        await Handler().Handle(new SetSuppliesCostCommand(water, 1m), CancellationToken.None);

        var cost = (await Cost(water))!;

        cost.TotalCost.ShouldBe(1m);
        cost.MarginPercent.ShouldBe(95m);
    }

    [Fact]
    public async Task SuppliesCost_MissingProduct_ReturnsFalse()
    {
        (await Handler().Handle(new SetSuppliesCostCommand(Guid.NewGuid(), 1m), CancellationToken.None)).ShouldBeFalse();
    }
}
