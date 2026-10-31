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
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, latte, dairy, 200m);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);

        var limits = await new GetPosStockLimitsHandler(TestDb.Create(_db))
            .Handle(new GetPosStockLimitsQuery(), CancellationToken.None);

        limits.Links.Count.ShouldBe(2);
        limits.Links.Single(l => l.ProductId == oatAddOn).ReplacesItemId.ShouldBe(dairy);
    }

    private AssignItemProductLinksHandler Assign() => new(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

    [Fact]
    public async Task Assign_SavesReplacementOnAnAddOn()
    {
        await ItemSeed.User(_db, _userId);
        var oat = await ItemSeed.Item(_db, _userId, "Oat");
        var dairy = await ItemSeed.Item(_db, _userId, "Dairy");
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);

        var dto = await Assign().Handle(new AssignItemProductLinksCommand
        {
            ItemId = oat.Id,
            ProductLinks = [new ProductItemLinkAssignmentDto(oatAddOn, 200m, true, 0m, dairy.Id)]
        }, CancellationToken.None);

        var link = dto!.ProductLinks.Single();
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
            ProductLinks = [new ProductItemLinkAssignmentDto(latte, 200m, true, 0m, dairy.Id)]
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
            ProductLinks = [new ProductItemLinkAssignmentDto(oatAddOn, 200m, true, 0m, oat.Id)]
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
            ProductLinks = [new ProductItemLinkAssignmentDto(oatAddOn, 200m, true, 0m, Guid.NewGuid())]
        }, CancellationToken.None));
    }

    [Fact]
    public async Task RecipeCost_ReportsTheReplaceFlag()
    {
        var oat = StockSeed.Item(_db, "Oat", 1000m, averageCost: 0.2m);
        var dairy = StockSeed.Item(_db, "Dairy", 1000m, averageCost: 0.1m);
        var oatAddOn = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, oatAddOn, oat, 200m, replacesItemId: dairy);

        var result = (await new GetProductRecipeCostHandler(TestDb.Create(_db))
            .Handle(new GetProductRecipeCostQuery(oatAddOn), CancellationToken.None))!;

        result.IsAddOn.ShouldBeTrue();
        var line = result.Lines.Single();
        line.ReplacesItemName.ShouldBe("Dairy");
    }
}
