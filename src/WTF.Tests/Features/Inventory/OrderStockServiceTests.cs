using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class OrderStockServiceTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;

    public OrderStockServiceTests()
    {
        _data = new OrderSeed(_db);
    }

    private OrderStockService Service() => new(TestDb.Create(_db), _audit, TestFakes.Alerts(TestDb.Create(_db)));

    private static readonly StockDeductionOptions Online = new();

    private Task<StockDeductionResult> Deduct(Guid orderId, StockDeductionOptions? options = null) =>
        Service().DeductForOrderAsync(orderId, _userId, options ?? Online, CancellationToken.None);

    private Task Restore(Guid orderId, params Guid[] notReturned) =>
        Service().RestoreForOrderAsync(orderId, _userId, notReturned.ToHashSet(), CancellationToken.None);

    [Fact]
    public async Task Deduct_CompletedOrder_TakesTheLinkedQuantityAndWritesASaleMovement()
    {
        var milk = StockSeed.Item(_db, "Oat Milk", 10000m, cost: 0.15m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var line = _data.AddLine(order, latte, 3);

        var result = await Deduct(order);

        result.Warnings.ShouldBeEmpty();
        StockSeed.Balance(_db, milk).ShouldBe(9400m);
        var movement = StockSeed.Movements(_db, milk).Single();
        movement.MovementType.ShouldBe("Sale");
        movement.QuantityDelta.ShouldBe(-600m);
        movement.QuantityBefore.ShouldBe(10000m);
        movement.QuantityAfter.ShouldBe(9400m);
        movement.UnitCost.ShouldBe(0.15m);
        movement.ReferenceType.ShouldBe("Order");
        movement.ReferenceId.ShouldBe(order);
        movement.ProductId.ShouldBe(latte);
        movement.OrderItemId.ShouldBe(line);
        await _audit.Received(1).LogAsync(AuditAction.OrderStockDeducted, AuditEntityType.Order, order.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Deduct_SavingTheSameOrderTwice_NeverDeductsTwice()
    {
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 2);

        await Deduct(order);
        await Deduct(order);

        StockSeed.Balance(_db, milk).ShouldBe(600m);
        StockSeed.Movements(_db, milk).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Deduct_LinkedItemIsInactive_TakesNothingNeverBlocksAndSaysSo()
    {
        var cup = StockSeed.Item(_db, "Cup", 0m, allowNegative: false, active: false);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, cup, 1m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 2);

        var result = await Deduct(order);

        result.Warnings.ShouldBe(["Cup is inactive, so this sale did not take stock from it."]);
        StockSeed.Balance(_db, cup).ShouldBe(0m);
        StockSeed.Movements(_db, cup).ShouldBeEmpty();
    }

    [Fact]
    public async Task Deduct_ActiveAndInactiveItemsOnOneProduct_TakesTheActiveOneAndWarnsAboutTheOther()
    {
        var cup = StockSeed.Item(_db, "Cup", 10m);
        var lid = StockSeed.Item(_db, "Lid", 10m, active: false);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, cup, 1m);
        StockSeed.Link(_db, latte, lid, 1m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 3);

        var result = await Deduct(order);

        result.Warnings.ShouldBe(["Lid is inactive, so this sale did not take stock from it."]);
        StockSeed.Balance(_db, cup).ShouldBe(7m);
        StockSeed.Balance(_db, lid).ShouldBe(10m);
    }

    [Fact]
    public async Task Deduct_InactiveItemWithTheLinkSwitchedOff_SaysNothing()
    {
        var cup = StockSeed.Item(_db, "Cup", 10m, active: false);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, cup, 1m, active: false);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 1);

        (await Deduct(order)).Warnings.ShouldBeEmpty();
    }

    [Fact]
    public async Task Deduct_AddOnLinesAndSharedItems_AreSummedBeforeTheCheck()
    {
        var cup = StockSeed.Item(_db, "Cup", 10m, allowNegative: false);
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = _data.AddProduct("Latte", 150m);
        var mocha = _data.AddProduct("Mocha", 160m);
        var oat = _data.AddProduct("Oat", 30m, isAddOn: true);
        StockSeed.Link(_db, latte, cup, 1m);
        StockSeed.Link(_db, mocha, cup, 1m);
        StockSeed.Link(_db, oat, milk, 100m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var latteLine = _data.AddLine(order, latte, 3);
        _data.AddLine(order, oat, 2, parentId: latteLine);
        _data.AddLine(order, mocha, 2);

        await Deduct(order);

        StockSeed.Balance(_db, cup).ShouldBe(5m);
        // 3 lattes x 2 oat shots x 100 ml
        StockSeed.Balance(_db, milk).ShouldBe(4400m);
    }

    [Fact]
    public async Task Deduct_InactiveLinksItemsAndUnlinkedProducts_AreIgnored()
    {
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var gone = StockSeed.Item(_db, "Old syrup", 1000m, active: false);
        var latte = _data.AddProduct("Latte", 150m);
        var tea = _data.AddProduct("Tea", 90m);
        var water = _data.AddProduct("Water", 20m);
        StockSeed.Link(_db, latte, milk, 200m, active: false);
        StockSeed.Link(_db, tea, gone, 1m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte);
        _data.AddLine(order, tea);
        _data.AddLine(order, water);

        await Deduct(order);

        StockSeed.Balance(_db, milk).ShouldBe(1000m);
        StockSeed.Balance(_db, gone).ShouldBe(1000m);
        StockSeed.Movements(_db, milk).ShouldBeEmpty();
    }

    [Fact]
    public async Task Deduct_BlockingItemRunsShort_RefusesNamingTheItemAndTheShortfall()
    {
        var milk = StockSeed.Item(_db, "Oat Milk", 100m, allowNegative: false);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 3);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Deduct(order));

        ex.Message.ShouldContain("Oat Milk");
        ex.Message.ShouldContain("short by 500 ml");
        StockSeed.Balance(_db, milk).ShouldBe(100m);
        StockSeed.Movements(_db, milk).ShouldBeEmpty();
    }

    [Fact]
    public async Task Deduct_WarnOnlyItemRunsShort_GoesNegativeWithAWarning()
    {
        var milk = StockSeed.Item(_db, "Oat Milk", 100m, allowNegative: true);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 3);

        var result = await Deduct(order);

        StockSeed.Balance(_db, milk).ShouldBe(-500m);
        result.Warnings.Single().ShouldContain("below zero");
        StockSeed.Movements(_db, milk).Single().Notes.ShouldBe("Balance went below zero");
    }

    [Fact]
    public async Task Deduct_BlockingItemWhenTheSaleAlreadyHappened_GoesNegativeInsteadOfRefusing()
    {
        var milk = StockSeed.Item(_db, "Oat Milk", 100m, allowNegative: false);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 1);

        var result = await Deduct(order, new StockDeductionOptions(BlockWhenShort: false));

        StockSeed.Balance(_db, milk).ShouldBe(-100m);
        result.Warnings.Single().ShouldContain("below zero");
    }

    [Fact]
    public async Task Deduct_RunningLow_WarnsWithoutGoingNegative()
    {
        var milk = StockSeed.Item(_db, "Milk", 1000m, warning: 500m, critical: 200m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 3);

        var result = await Deduct(order);

        result.Warnings.Single().ShouldContain("running low");
        StockSeed.Balance(_db, milk).ShouldBe(400m);
    }

    [Fact]
    public async Task Deduct_CorrectionAfterMoreItems_TakesOnlyTheNetDifference()
    {
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 2);
        await Deduct(order);

        // The edit rebuilds the lines: 2 lattes become 3.
        await using (var db = TestDb.Create(_db))
        {
            db.OrderItems.RemoveRange(db.OrderItems.Where(oi => oi.OrderId == order));
            await db.SaveChangesAsync();
        }

        _data.AddLine(order, latte, 3);
        await Deduct(order, new StockDeductionOptions(IsCorrection: true));

        StockSeed.Balance(_db, milk).ShouldBe(4400m);
        var movements = StockSeed.Movements(_db, milk);
        movements.Count.ShouldBe(2);
        movements[1].QuantityDelta.ShouldBe(-200m);
    }

    [Fact]
    public async Task Deduct_CorrectionAfterFewerItems_GivesTheDifferenceBackAsASaleVoid()
    {
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 3);
        await Deduct(order);

        await using (var db = TestDb.Create(_db))
        {
            db.OrderItems.RemoveRange(db.OrderItems.Where(oi => oi.OrderId == order));
            await db.SaveChangesAsync();
        }

        _data.AddLine(order, latte, 1);
        await Deduct(order, new StockDeductionOptions(IsCorrection: true));

        StockSeed.Balance(_db, milk).ShouldBe(4800m);
        var last = StockSeed.Movements(_db, milk).Last();
        last.MovementType.ShouldBe("SaleVoid");
        last.QuantityDelta.ShouldBe(400m);
    }

    [Fact]
    public async Task Deduct_CorrectionOfAnOrderFromBeforeStockTracking_DeductsNothing()
    {
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed, createdAt: DateTime.UtcNow.AddDays(-30));
        _data.AddLine(order, latte, 2);

        await Deduct(order, new StockDeductionOptions(IsCorrection: true));

        StockSeed.Balance(_db, milk).ShouldBe(5000m);
    }

    [Fact]
    public async Task Restore_UsesTheOriginalMovements_EvenAfterTheLinkQuantityChanged()
    {
        var milk = StockSeed.Item(_db, "Milk", 5000m);
        var latte = _data.AddProduct("Latte", 150m);
        var link = StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(order, latte, 3);
        await Deduct(order);

        StockSeed.SetLinkQuantity(_db, link, 500m);
        await Restore(order);

        StockSeed.Balance(_db, milk).ShouldBe(5000m);
        var movements = StockSeed.Movements(_db, milk);
        movements.Count.ShouldBe(2);
        movements[1].MovementType.ShouldBe("SaleVoid");
        movements[1].QuantityDelta.ShouldBe(600m);
        await _audit.Received(1).LogAsync(AuditAction.OrderStockRestored, AuditEntityType.Order, order.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Restore_LineNotReturned_WritesTheSaleVoidAndAWasteMovementSoTheBalanceStays()
    {
        var milk = StockSeed.Item(_db, "Milk", 10000m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Completed);
        var first = _data.AddLine(order, latte, 2);
        _data.AddLine(order, latte, 1);
        await Deduct(order);

        await Restore(order, first);

        // 600 ml were sold; the one latte that goes back (200 ml) returns, the 2 that were made (400 ml) are waste.
        StockSeed.Balance(_db, milk).ShouldBe(9600m);
        var movements = StockSeed.Movements(_db, milk);
        movements.Select(m => m.MovementType).ShouldBe(["Sale", "SaleVoid", "Waste"]);
        movements[1].QuantityDelta.ShouldBe(600m);
        movements[2].QuantityDelta.ShouldBe(-400m);
        movements[2].Notes.ShouldBe("Refunded, not resaleable");
    }

    [Fact]
    public async Task Restore_OrderThatTookNothing_DoesNothing()
    {
        var milk = StockSeed.Item(_db, "Milk", 1000m);
        var latte = _data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, milk, 200m);
        var order = _data.AddOrder(OrderStatusEnum.Pending);
        _data.AddLine(order, latte, 2);

        await Restore(order);

        StockSeed.Balance(_db, milk).ShouldBe(1000m);
        StockSeed.Movements(_db, milk).ShouldBeEmpty();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
