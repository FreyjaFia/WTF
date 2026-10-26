using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class AddItemStockHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private AddItemStockHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit, TestFakes.Alerts(TestDb.Create(_db)));

    [Fact]
    public async Task Handle_MissingItem_ReturnsNull()
    {
        var r = await Handler().Handle(new AddItemStockCommand { ItemId = Guid.NewGuid(), Quantity = 1 }, CancellationToken.None);
        r.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_InactiveItem_IsRefusedAndNothingIsWritten()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10, active: false);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new AddItemStockCommand { ItemId = item.Id, Quantity = 5 }, CancellationToken.None));

        ex.Message.ShouldContain("Restore it");
        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).CurrentQuantity.ShouldBe(10m);
        (await db.StockMovements.CountAsync()).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_Quantity_IncreasesStockAndRecordsMovement()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        var dto = await Handler().Handle(
            new AddItemStockCommand { ItemId = item.Id, Quantity = 2.5m, Notes = "  delivery " }, CancellationToken.None);

        dto!.CurrentQuantity.ShouldBe(12.5m);
        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).CurrentQuantity.ShouldBe(12.5m);
        var m = await db.StockMovements.SingleAsync();
        m.MovementType.ShouldBe("AddStock");
        m.QuantityDelta.ShouldBe(2.5m);
        m.QuantityBefore.ShouldBe(10m);
        m.QuantityAfter.ShouldBe(12.5m);
        m.Notes.ShouldBe("delivery");
        m.CreatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(AuditAction.ItemStockAdded, AuditEntityType.StockMovement, m.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_NewUnitCost_UpdatesCostRecordsHistoryAndMovementCost()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: 4);

        await Handler().Handle(new AddItemStockCommand { ItemId = item.Id, Quantity = 1, UnitCost = 6 }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).CostPrice.ShouldBe(6m);
        var h = await db.ItemPriceHistories.SingleAsync();
        h.OldPrice.ShouldBe(4m);
        h.NewPrice.ShouldBe(6m);
        (await db.StockMovements.SingleAsync()).UnitCost.ShouldBe(6m);
    }

    [Fact]
    public async Task Handle_SameUnitCost_AddsNoPriceHistory()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: 4);

        await Handler().Handle(new AddItemStockCommand { ItemId = item.Id, Quantity = 1, UnitCost = 4 }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ItemPriceHistories.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_NoUnitCost_KeepsCostAndAddsNoHistory()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: 4);

        await Handler().Handle(new AddItemStockCommand { ItemId = item.Id, Quantity = 1 }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).CostPrice.ShouldBe(4m);
        (await db.ItemPriceHistories.CountAsync()).ShouldBe(0);
        (await db.StockMovements.SingleAsync()).UnitCost.ShouldBeNull();
    }
}
