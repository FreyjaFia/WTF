using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Features.Items;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class RecipeSizeAndReplaceTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data;

    public RecipeSizeAndReplaceTests()
    {
        _data = new OrderSeed(_db);
    }

    private OrderStockService Service() => new(TestDb.Create(_db), TestFakes.Audit(), TestFakes.Alerts(TestDb.Create(_db)));

    private Task Deduct(Guid orderId) =>
        Service().DeductForOrderAsync(orderId, _userId, new StockDeductionOptions(), CancellationToken.None);

    private void SetMultiplier(Guid productId, decimal multiplier)
    {
        using var db = TestDb.Create(_db);
        db.Products.Single(p => p.Id == productId).RecipeMultiplier = multiplier;
        db.SaveChanges();
    }

    [Fact]
    public async Task AReplacingAddOn_TakesItsOwnItemAndNotTheDrinksItem()
    {
        var dairy = StockSeed.Item(_db, "Dairy", 1000m);
        var oat = StockSeed.Item(_db, "Oat", 1000m);
        var latte = _data.AddProduct("Latte", 150m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, latte, dairy, 200m);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(order, latte, 2);
        _data.AddLine(order, oatAddOn, 1, parentId: line);

        await Deduct(order);

        StockSeed.Balance(_db, dairy).ShouldBe(1000m);
        StockSeed.Balance(_db, oat).ShouldBe(600m);
    }

    [Fact]
    public async Task WithoutTheReplacingAddOn_TheDrinkTakesItsItem()
    {
        var dairy = StockSeed.Item(_db, "Dairy", 1000m);
        var oat = StockSeed.Item(_db, "Oat", 1000m);
        var latte = _data.AddProduct("Latte", 150m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, latte, dairy, 200m);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 2);

        await Deduct(order);

        StockSeed.Balance(_db, dairy).ShouldBe(600m);
        StockSeed.Balance(_db, oat).ShouldBe(1000m);
    }

    [Fact]
    public async Task AddingTheReplacingAddOnToACompletedOrder_GivesBackWhatTheDrinkTook()
    {
        var dairy = StockSeed.Item(_db, "Dairy", 1000m);
        var oat = StockSeed.Item(_db, "Oat", 1000m);
        var latte = _data.AddProduct("Latte", 150m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, latte, dairy, 200m);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(order, latte, 1);
        await Deduct(order);
        StockSeed.Balance(_db, dairy).ShouldBe(800m);

        _data.AddLine(order, oatAddOn, 1, parentId: line);
        await Deduct(order);

        StockSeed.Balance(_db, dairy).ShouldBe(1000m);
        StockSeed.Balance(_db, oat).ShouldBe(800m);
    }

    [Fact]
    public async Task ASizeAddOn_ScalesOnlyTheLinesMarkedToScale()
    {
        var milk = StockSeed.Item(_db, "Milk", 10000m);
        var lid = StockSeed.Item(_db, "Lid", 100m);
        var latte = _data.AddProduct("Latte", 150m);
        var large = _data.AddProduct("Large", 20m, isAddOn: true);
        SetMultiplier(large, 1.5m);
        StockSeed.Link(_db, latte, milk, 200m, scalesWithSize: true);
        StockSeed.Link(_db, latte, lid, 1m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(order, latte, 2);
        _data.AddLine(order, large, 1, parentId: line);

        await Deduct(order);

        StockSeed.Balance(_db, milk).ShouldBe(9400m);
        StockSeed.Balance(_db, lid).ShouldBe(98m);
    }

    [Fact]
    public async Task AReplacingAddOnThatScales_TakesTheBiggerAmount()
    {
        var oat = StockSeed.Item(_db, "Oat", 10000m);
        var dairy = StockSeed.Item(_db, "Dairy", 10000m);
        var latte = _data.AddProduct("Latte", 150m);
        var large = _data.AddProduct("Large", 20m, isAddOn: true);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        SetMultiplier(large, 1.5m);
        StockSeed.Link(_db, latte, dairy, 200m, scalesWithSize: true);
        StockSeed.Link(_db, oatAddOn, oat, 200m, scalesWithSize: true, replacesItemId: dairy);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(order, latte, 1);
        _data.AddLine(order, large, 1, parentId: line);
        _data.AddLine(order, oatAddOn, 1, parentId: line);

        await Deduct(order);

        StockSeed.Balance(_db, dairy).ShouldBe(10000m);
        StockSeed.Balance(_db, oat).ShouldBe(9700m);
    }

    [Fact]
    public async Task AReplacingAddOnWhoseItemIsInactive_StillReplacesAndTakesNothing()
    {
        var dairy = StockSeed.Item(_db, "Dairy", 1000m);
        var oat = StockSeed.Item(_db, "Oat", 1000m, active: false);
        var latte = _data.AddProduct("Latte", 150m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, latte, dairy, 200m);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(order, latte, 1);
        _data.AddLine(order, oatAddOn, 1, parentId: line);

        await Deduct(order);

        StockSeed.Balance(_db, dairy).ShouldBe(1000m);
        StockSeed.Balance(_db, oat).ShouldBe(1000m);
    }

    [Fact]
    public async Task TheRegisterLimitsCarryReplaceAndSizeInformation()
    {
        var dairy = StockSeed.Item(_db, "Dairy", 100m, allowNegative: false);
        var oat = StockSeed.Item(_db, "Oat", 100m);
        var latte = _data.AddProduct("Latte", 150m);
        var large = _data.AddProduct("Large", 20m, isAddOn: true);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        SetMultiplier(large, 1.5m);
        StockSeed.Link(_db, latte, dairy, 200m, scalesWithSize: true);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);

        var limits = await new GetPosStockLimitsHandler(TestDb.Create(_db))
            .Handle(new GetPosStockLimitsQuery(), CancellationToken.None);

        limits.Links.Count.ShouldBe(2);
        limits.Links.Single(l => l.ProductId == latte).ScalesWithSize.ShouldBeTrue();
        limits.Links.Single(l => l.ProductId == oatAddOn).ReplacesItemId.ShouldBe(dairy);
        limits.SizeMultipliers!.Single().ProductId.ShouldBe(large);
        limits.SizeMultipliers!.Single().Multiplier.ShouldBe(1.5m);
    }

    private SetRecipeMultiplierHandler Multiplier() =>
        new(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

    [Fact]
    public async Task SetRecipeMultiplier_SavesItOnAnAddOn()
    {
        await ItemSeed.User(_db, _userId);
        var large = _data.AddProduct("Large", 20m, isAddOn: true);

        (await Multiplier().Handle(new SetRecipeMultiplierCommand(large, 1.5m), CancellationToken.None)).ShouldBeTrue();

        await using var db = TestDb.Create(_db);
        (await db.Products.SingleAsync(p => p.Id == large)).RecipeMultiplier.ShouldBe(1.5m);
    }

    [Fact]
    public async Task SetRecipeMultiplier_RefusesAProductThatIsNotAnAddOn()
    {
        await ItemSeed.User(_db, _userId);
        var latte = _data.AddProduct("Latte", 150m);

        await Should.ThrowAsync<InvalidOperationException>(
            () => Multiplier().Handle(new SetRecipeMultiplierCommand(latte, 1.5m), CancellationToken.None));
    }

    [Fact]
    public async Task SetRecipeMultiplier_MissingProduct_ReturnsFalse()
    {
        (await Multiplier().Handle(new SetRecipeMultiplierCommand(Guid.NewGuid(), 1.5m), CancellationToken.None)).ShouldBeFalse();
    }

    private AssignItemProductLinksHandler Assign() => new(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

    [Fact]
    public async Task Assign_SavesScalingAndReplacementOnAnAddOn()
    {
        await ItemSeed.User(_db, _userId);
        var oat = await ItemSeed.Item(_db, _userId, "Oat");
        var dairy = await ItemSeed.Item(_db, _userId, "Dairy");
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);

        var dto = await Assign().Handle(new AssignItemProductLinksCommand
        {
            ItemId = oat.Id,
            ProductLinks = [new ProductItemLinkAssignmentDto(oatAddOn, 200m, true, 0m, true, dairy.Id)]
        }, CancellationToken.None);

        var link = dto!.ProductLinks.Single();
        link.ScalesWithSize.ShouldBeTrue();
        link.ReplacesItemId.ShouldBe(dairy.Id);
        link.ReplacesItemName.ShouldBe("Dairy");
    }

    [Fact]
    public async Task Assign_RefusesAReplacementOnAProductThatIsNotAnAddOn()
    {
        await ItemSeed.User(_db, _userId);
        var oat = await ItemSeed.Item(_db, _userId, "Oat");
        var dairy = await ItemSeed.Item(_db, _userId, "Dairy");
        var latte = _data.AddProduct("Latte", 150m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Assign().Handle(new AssignItemProductLinksCommand
        {
            ItemId = oat.Id,
            ProductLinks = [new ProductItemLinkAssignmentDto(latte, 200m, true, 0m, false, dairy.Id)]
        }, CancellationToken.None));

        ex.Message.ShouldContain("add-on");
    }

    [Fact]
    public async Task Assign_RefusesAnItemReplacingItself()
    {
        await ItemSeed.User(_db, _userId);
        var oat = await ItemSeed.Item(_db, _userId, "Oat");
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);

        await Should.ThrowAsync<InvalidOperationException>(() => Assign().Handle(new AssignItemProductLinksCommand
        {
            ItemId = oat.Id,
            ProductLinks = [new ProductItemLinkAssignmentDto(oatAddOn, 200m, true, 0m, false, oat.Id)]
        }, CancellationToken.None));
    }

    [Fact]
    public async Task Assign_RefusesAnUnknownItemToReplace()
    {
        await ItemSeed.User(_db, _userId);
        var oat = await ItemSeed.Item(_db, _userId, "Oat");
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);

        await Should.ThrowAsync<InvalidOperationException>(() => Assign().Handle(new AssignItemProductLinksCommand
        {
            ItemId = oat.Id,
            ProductLinks = [new ProductItemLinkAssignmentDto(oatAddOn, 200m, true, 0m, false, Guid.NewGuid())]
        }, CancellationToken.None));
    }

    [Fact]
    public async Task RecipeCost_ReportsTheFlagsAndTheMultiplier()
    {
        var oat = StockSeed.Item(_db, "Oat", 1000m, averageCost: 0.2m);
        var dairy = StockSeed.Item(_db, "Dairy", 1000m, averageCost: 0.1m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        SetMultiplier(oatAddOn, 2m);
        StockSeed.Link(_db, oatAddOn, oat, 200m, scalesWithSize: true, replacesItemId: dairy);

        var result = (await new GetProductRecipeCostHandler(TestDb.Create(_db))
            .Handle(new GetProductRecipeCostQuery(oatAddOn), CancellationToken.None))!;

        result.IsAddOn.ShouldBeTrue();
        result.RecipeMultiplier.ShouldBe(2m);
        var line = result.Lines.Single();
        line.ScalesWithSize.ShouldBeTrue();
        line.ReplacesItemName.ShouldBe("Dairy");
    }
}
