using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Tests.Features.Items;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class AdjustItemStockHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private AdjustItemStockHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit);

    private static AdjustItemStockCommand Counted(Guid itemId, decimal counted, decimal? expected = null, string reason = "Count correction", string? notes = null) =>
        new() { ItemId = itemId, CountedQuantity = counted, ExpectedQuantity = expected, Reason = reason, Notes = notes };

    private static AdjustItemStockCommand Change(Guid itemId, decimal change, string reason = "Lost") =>
        new() { ItemId = itemId, QuantityChange = change, Reason = reason };

    [Fact]
    public async Task Handle_UnknownItem_ReturnsNull()
    {
        (await Handler().Handle(Change(Guid.NewGuid(), -1), CancellationToken.None)).ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_CountedQuantity_WritesAnAdjustmentMovementAndAuditsIt()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        var dto = await Handler().Handle(Counted(item.Id, 7m, notes: "  shelf count "), CancellationToken.None);

        dto!.CurrentQuantity.ShouldBe(7m);
        await using var db = TestDb.Create(_db);
        var movement = await db.StockMovements.SingleAsync();
        movement.MovementType.ShouldBe("Adjustment");
        movement.QuantityDelta.ShouldBe(-3m);
        movement.QuantityBefore.ShouldBe(10m);
        movement.QuantityAfter.ShouldBe(7m);
        movement.Notes.ShouldBe("Count correction: shelf count");
        movement.CreatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(AuditAction.ItemStockAdjusted, AuditEntityType.StockMovement, movement.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_SalesCompletedWhileTheFormWasOpen_AreKeptBecauseTheDifferenceIsAppliedOnTop()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 8);

        // The form showed 10 and the counter found 7, so 3 are missing. Two were sold meanwhile (balance 8): 8 - 3 = 5.
        var dto = await Handler().Handle(Counted(item.Id, 7m, expected: 10m), CancellationToken.None);

        dto!.CurrentQuantity.ShouldBe(5m);
    }

    [Fact]
    public async Task Handle_PlusMinusChange_AppliesIt()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        var dto = await Handler().Handle(Change(item.Id, 4m), CancellationToken.None);

        dto!.CurrentQuantity.ShouldBe(14m);
    }

    [Fact]
    public async Task Handle_FixesANegativeBalance()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: -500);

        var dto = await Handler().Handle(Counted(item.Id, 0m), CancellationToken.None);

        dto!.CurrentQuantity.ShouldBe(0m);
        await using var db = TestDb.Create(_db);
        (await db.StockMovements.SingleAsync()).QuantityDelta.ShouldBe(500m);
    }

    [Theory]
    [InlineData("")]
    [InlineData("Because")]
    public async Task Handle_ReasonNotInTheList_Throws(string reason)
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Change(item.Id, -1, reason), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_OtherWithoutANote_Throws()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Change(item.Id, -1, "Other"), CancellationToken.None));

        ex.Message.ShouldContain("note");
    }

    [Fact]
    public async Task Handle_BothOrNeitherOfCountAndChange_Throws()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new AdjustItemStockCommand { ItemId = item.Id, Reason = "Lost" }, CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new AdjustItemStockCommand { ItemId = item.Id, CountedQuantity = 5, QuantityChange = -5, Reason = "Lost" }, CancellationToken.None));
    }

    [Fact]
    public async Task Handle_CountEqualToTheBalance_Throws()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Counted(item.Id, 10m), CancellationToken.None));

        ex.Message.ShouldContain("nothing to adjust");
    }

    [Fact]
    public async Task Handle_BlockingItemWouldGoBelowZero_IsRefused()
    {
        await ItemSeed.User(_db, _userId);
        var id = StockSeed.Item(_db, "Strict", 2m, allowNegative: false);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(Change(id, -5m), CancellationToken.None));

        ex.Message.ShouldContain("negative balance");
        StockSeed.Balance(_db, id).ShouldBe(2m);
    }
}
