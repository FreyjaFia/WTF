using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class ProductIngredientsEditTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;

    public ProductIngredientsEditTests()
    {
        _data = new OrderSeed(_db);
    }

    private AssignProductIngredientsHandler Assign() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    private static AssignProductIngredientsCommand Cmd(Guid productId, params ProductIngredientInputDto[] lines) =>
        new() { ProductId = productId, Lines = [.. lines] };

    private Task<WTF.Api.Features.Inventory.DTOs.ProductIngredientsEditDto?> Read(Guid productId, bool costs = true) =>
        new GetProductIngredientsEditHandler(TestDb.Create(_db)).Handle(new GetProductIngredientsEditQuery(productId, costs), CancellationToken.None);

    [Fact]
    public async Task Read_MissingProduct_ReturnsNull() => (await Read(Guid.NewGuid())).ShouldBeNull();

    [Fact]
    public async Task Read_ShowsTheLinesWithTheirCostAndTheMargin()
    {
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m), 200m, allowancePercent: 5m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Cup", 50m, cost: 4m), 1m);

        var result = (await Read(latte))!;

        result.Lines.Select(l => l.ItemName).ShouldBe(["Cup", "Milk"]);
        result.TotalCost.ShouldBe(35.5m);
        result.Margin.ShouldBe(114.5m);
        result.ShowsCosts.ShouldBeTrue();
    }

    [Fact]
    public async Task Read_WithoutCostAccess_HidesEveryCost()
    {
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, StockSeed.Item(_db, "Milk", 1000m, averageCost: 0.15m), 200m);

        var result = (await Read(latte, costs: false))!;

        result.Lines.Single().QuantityPerSale.ShouldBe(200m);
        result.Lines.Single().UnitCost.ShouldBeNull();
        result.Lines.Single().LineCost.ShouldBeNull();
        result.TotalCost.ShouldBeNull();
        result.Margin.ShouldBeNull();
        result.SuppliesCost.ShouldBeNull();
        result.ShowsCosts.ShouldBeFalse();
    }

    [Fact]
    public async Task Assign_MissingProduct_ReturnsFalse() =>
        (await Assign().Handle(Cmd(Guid.NewGuid()), CancellationToken.None)).ShouldBeFalse();

    [Fact]
    public async Task Assign_NewLines_AreSavedAndAudited()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var cup = StockSeed.Item(_db, "Cup", 50m);

        (await Assign().Handle(Cmd(latte,
            new ProductIngredientInputDto(milk, 200m, 5m, true),
            new ProductIngredientInputDto(cup, 1m)), CancellationToken.None)).ShouldBeTrue();

        await using var db = TestDb.Create(_db);
        var links = await db.ProductItemLinks.Where(l => l.ProductId == latte).ToListAsync();
        links.Count.ShouldBe(2);
        var milkLink = links.Single(l => l.ItemId == milk);
        milkLink.QuantityPerSale.ShouldBe(200m);
        milkLink.AllowancePercent.ShouldBe(5m);
        milkLink.ScalesWithSize.ShouldBeTrue();
        milkLink.IsActive.ShouldBeTrue();
        await _audit.Received(1).LogAsync(
            AuditAction.ProductItemLinked, AuditEntityType.ProductItemLink, latte.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Assign_ExistingLine_IsUpdatedInPlace()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var linkId = StockSeed.Link(_db, latte, milk, 200m);

        await Assign().Handle(Cmd(latte, new ProductIngredientInputDto(milk, 250m, 2m)), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var link = await db.ProductItemLinks.SingleAsync();
        link.Id.ShouldBe(linkId);
        link.QuantityPerSale.ShouldBe(250m);
        link.AllowancePercent.ShouldBe(2m);
    }

    [Fact]
    public async Task Assign_ALineLeftOut_IsSwitchedOffAndKept_AndComesBackWhenListedAgain()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var cup = StockSeed.Item(_db, "Cup", 50m);
        StockSeed.Link(_db, latte, milk, 200m);
        StockSeed.Link(_db, latte, cup, 1m);

        await Assign().Handle(Cmd(latte, new ProductIngredientInputDto(milk, 200m)), CancellationToken.None);

        await using (var db = TestDb.Create(_db))
        {
            var cupLink = await db.ProductItemLinks.SingleAsync(l => l.ItemId == cup);
            cupLink.IsActive.ShouldBeFalse();
            cupLink.QuantityPerSale.ShouldBe(1m);
        }

        await Assign().Handle(Cmd(latte, new ProductIngredientInputDto(milk, 200m), new ProductIngredientInputDto(cup, 2m)), CancellationToken.None);

        await using var check = TestDb.Create(_db);
        (await check.ProductItemLinks.CountAsync()).ShouldBe(2);
        (await check.ProductItemLinks.SingleAsync(l => l.ItemId == cup)).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Assign_ALinkToAnInactiveItem_IsLeftAlone()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var old = StockSeed.Item(_db, "Old syrup", 10m, active: false);
        StockSeed.Link(_db, latte, old, 5m);

        await Assign().Handle(Cmd(latte), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.SingleAsync()).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Assign_AddingAnInactiveItem_IsRefused()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var old = StockSeed.Item(_db, "Old syrup", 10m, active: false);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(latte, new ProductIngredientInputDto(old, 5m)), CancellationToken.None));
        ex.Message.ShouldContain("Restore it first");
    }

    [Fact]
    public async Task Assign_DuplicateAndBadValues_AreRefused()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var milk = StockSeed.Item(_db, "Milk", 1000m);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(latte, new ProductIngredientInputDto(milk, 1m), new ProductIngredientInputDto(milk, 2m)), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(latte, new ProductIngredientInputDto(milk, 0m)), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(latte, new ProductIngredientInputDto(milk, 1m, 101m)), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(latte, new ProductIngredientInputDto(Guid.NewGuid(), 1m)), CancellationToken.None));
    }

    [Fact]
    public async Task Assign_Replace_OnlyForAnAddOn_AndNeverTheSameItem()
    {
        var latte = _data.AddProduct("Latte", 150m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var oat = StockSeed.Item(_db, "Oat milk", 1000m);

        var notAddOn = await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(latte, new ProductIngredientInputDto(oat, 200m, 0m, false, milk)), CancellationToken.None));
        notAddOn.Message.ShouldContain("Only an add-on");

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Assign().Handle(Cmd(oatAddOn, new ProductIngredientInputDto(oat, 200m, 0m, false, oat)), CancellationToken.None));

        (await Assign().Handle(Cmd(oatAddOn, new ProductIngredientInputDto(oat, 200m, 0m, false, milk)), CancellationToken.None)).ShouldBeTrue();
        (await Read(oatAddOn))!.Lines.Single().ReplacesItemName.ShouldBe("Milk");
    }
}
