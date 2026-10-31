using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Services;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class SizeAmountTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;

    private readonly Guid _latte;
    private readonly Guid _large;
    private readonly Guid _milk;
    private readonly Guid _cup;

    public SizeAmountTests()
    {
        _data = new OrderSeed(_db);
        _latte = _data.AddProduct("Latte", 150m);
        _large = _data.AddProduct("Large", 30m, isAddOn: true);
        _data.AllowAddOn(_latte, _large, AddOnTypeEnum.Size);
        _milk = StockSeed.Item(_db, "Milk", 5000m, averageCost: 0.15m);
        _cup = StockSeed.Item(_db, "Large Cup", 50m, cost: 4m);
    }

    private AssignProductIngredientsHandler Assign() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    private Task<bool> Save(Guid productId, params ProductIngredientInputDto[] lines) =>
        Assign().Handle(new AssignProductIngredientsCommand { ProductId = productId, Lines = [.. lines] }, CancellationToken.None);

    private static ProductIngredientInputDto Line(Guid item, decimal quantity, params ProductSizeAmountInputDto[] amounts) =>
        new(item, quantity, SizeAmounts: [.. amounts]);

    private Task<WTF.Api.Features.Inventory.DTOs.RecipePreviewDto?> Preview(params Guid[] addOns) =>
        new GetProductRecipePreviewHandler(TestDb.Create(_db))
            .Handle(new GetProductRecipePreviewQuery(_latte, [.. addOns]), CancellationToken.None);

    [Fact]
    public async Task Assign_SizeAmounts_AreSavedAndComeBackOnTheEditRead()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));

        var read = (await new GetProductIngredientsEditHandler(TestDb.Create(_db))
            .Handle(new GetProductIngredientsEditQuery(_latte, true), CancellationToken.None))!;

        read.Sizes!.Select(s => s.ProductId).ShouldBe([_large]);
        var amount = read.Lines.Single().SizeAmounts!.Single();
        amount.SizeProductId.ShouldBe(_large);
        amount.Quantity.ShouldBe(300m);
    }

    [Fact]
    public async Task Assign_DroppingASizeAmount_SwitchesItOffAndKeepsTheRow()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));
        await Save(_latte, Line(_milk, 200m));

        await using var db = TestDb.Create(_db);
        var row = await db.ProductSizeAmounts.SingleAsync();
        row.IsActive.ShouldBeFalse();
        row.Quantity.ShouldBe(300m);
    }

    [Fact]
    public async Task Assign_ASizeAmountComesBack_WhenSavedAgain()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));
        await Save(_latte, Line(_milk, 200m));
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 320m)));

        await using var db = TestDb.Create(_db);
        var row = await db.ProductSizeAmounts.SingleAsync();
        row.IsActive.ShouldBeTrue();
        row.Quantity.ShouldBe(320m);
    }

    [Fact]
    public async Task Assign_SizeAmountForSomethingThatIsNotASize_IsRefused()
    {
        var oat = _data.AddProduct("Oat", 20m, isAddOn: true);
        _data.AllowAddOn(_latte, oat, AddOnTypeEnum.Extra);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(oat, 300m))));

        ex.Message.ShouldContain("not a size");
    }

    [Fact]
    public async Task Assign_TheSameSizeTwiceOnOneIngredient_IsRefused()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m), new ProductSizeAmountInputDto(_large, 310m))));

        ex.Message.ShouldContain("one amount per size");
    }

    [Fact]
    public async Task Assign_ASizeAmountOfZero_IsRefused()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 0m))));

        ex.Message.ShouldContain("greater than zero");
    }

    [Fact]
    public async Task Assign_SizeAmountsOnAnAddOn_AreRefused()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Save(_large, Line(_milk, 50m, new ProductSizeAmountInputDto(_large, 60m))));

        ex.Message.ShouldContain("not on an add-on");
    }

    [Fact]
    public async Task Assign_SizeAmounts_AreAudited()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));

        await _audit.Received(1).LogAsync(
            AuditAction.ProductItemLinked, AuditEntityType.ProductItemLink, _latte.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Preview_WithoutASize_UsesTheBaseAmounts()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));

        var result = (await Preview())!;

        result.Lines.Single().Quantity.ShouldBe(200m);
        result.TotalCost.ShouldBe(30m);
        result.Price.ShouldBe(150m);
    }

    [Fact]
    public async Task Preview_WithASize_UsesItsAmountAndAddsItsPrice()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));

        var result = (await Preview(_large))!;

        result.Lines.Single().Quantity.ShouldBe(300m);
        result.TotalCost.ShouldBe(45m);
        result.Price.ShouldBe(180m);
        result.Margin.ShouldBe(135m);
        result.AddOnNames.ShouldBe(["Large"]);
        result.Warnings.ShouldBeEmpty();
    }

    [Fact]
    public async Task Preview_ASizeOnlyIngredient_IsAddedWithItsCostOnlyForThatSize()
    {
        await Save(_latte,
            Line(_milk, 200m),
            Line(_cup, 1m, new ProductSizeAmountInputDto(_large, 1m)));

        var large = (await Preview(_large))!;

        large.Lines.Single(l => l.ItemId == _cup).LineCost.ShouldBe(4m);
    }

    [Fact]
    public async Task Preview_ASizeWithNoAmountsOfItsOwn_WarnsThatItUsesTheBase()
    {
        var jumbo = _data.AddProduct("Jumbo", 50m, isAddOn: true);
        _data.AllowAddOn(_latte, jumbo, AddOnTypeEnum.Size);
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));

        var result = (await Preview(jumbo))!;

        result.Warnings.ShouldContain(w => w.Contains("Jumbo") && w.Contains("base amounts"));
    }

    [Fact]
    public async Task Preview_AnAddOnThatIsNotAnOptionOfTheProduct_IsRefused()
    {
        var stranger = _data.AddProduct("Stranger", 10m, isAddOn: true);

        await Should.ThrowAsync<InvalidOperationException>(() => Preview(stranger));
    }

    [Fact]
    public async Task Preview_MissingProduct_ReturnsNull() =>
        (await new GetProductRecipePreviewHandler(TestDb.Create(_db))
            .Handle(new GetProductRecipePreviewQuery(Guid.NewGuid(), []), CancellationToken.None)).ShouldBeNull();

    [Fact]
    public async Task Preview_SavesAndDeductsNothing()
    {
        await Save(_latte, Line(_milk, 200m));

        await Preview(_large);

        StockSeed.Balance(_db, _milk).ShouldBe(5000m);
        await using var db = TestDb.Create(_db);
        (await db.StockMovements.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task ASale_WithASize_TakesTheSizeAmountInsteadOfTheBaseAmount()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));
        var order = _data.AddOrder(WTF.Api.Features.Orders.Enums.OrderStatusEnum.Completed);
        var line = _data.AddLine(order, _latte, 2);
        _data.AddLine(order, _large, 1, parentId: line);

        await new OrderStockService(TestDb.Create(_db), TestFakes.Audit(), TestFakes.Alerts(TestDb.Create(_db)))
            .DeductForOrderAsync(order, _userId, new StockDeductionOptions(), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(4400m);
    }

    [Fact]
    public async Task ASale_WithoutTheSize_TakesTheBaseAmount()
    {
        await Save(_latte, Line(_milk, 200m, new ProductSizeAmountInputDto(_large, 300m)));
        var order = _data.AddOrder(WTF.Api.Features.Orders.Enums.OrderStatusEnum.Completed);
        _data.AddLine(order, _latte, 2);

        await new OrderStockService(TestDb.Create(_db), TestFakes.Audit(), TestFakes.Alerts(TestDb.Create(_db)))
            .DeductForOrderAsync(order, _userId, new StockDeductionOptions(), CancellationToken.None);

        StockSeed.Balance(_db, _milk).ShouldBe(4600m);
    }

    [Fact]
    public async Task TheRegisterLimits_CarryTheSizeAmountsOfBlockingItems()
    {
        var blocking = StockSeed.Item(_db, "Blocking Cup", 5m, allowNegative: false);
        await Save(_latte, Line(_milk, 200m), Line(blocking, 1m, new ProductSizeAmountInputDto(_large, 2m)));

        var result = await new GetPosStockLimitsHandler(TestDb.Create(_db)).Handle(new GetPosStockLimitsQuery(), CancellationToken.None);

        var amount = result.SizeAmounts!.Single();
        amount.ItemId.ShouldBe(blocking);
        amount.SizeProductId.ShouldBe(_large);
        amount.Quantity.ShouldBe(2m);
    }
}
