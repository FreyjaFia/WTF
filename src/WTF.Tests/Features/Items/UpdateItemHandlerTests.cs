using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Tests.Features.Inventory;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class UpdateItemHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private UpdateItemHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_userId), _audit, TestFakes.Alerts(TestDb.Create(_db)));

    [Fact]
    public async Task Handle_MissingItem_ReturnsNull()
    {
        var result = await Handler().Handle(new UpdateItemCommand { Id = Guid.NewGuid(), Name = "x", UnitName = "kg" },
            CancellationToken.None);
        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_ValidChange_UpdatesFieldsAndStampsUser()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, sku: "OLD", qty: 7);

        var dto = await Handler().Handle(new UpdateItemCommand
        {
            Id = item.Id,
            Name = " New ",
            Sku = " NEW ",
            UnitName = "g",
            IsActive = false,
            WarningQuantity = 3
        }, CancellationToken.None);

        dto!.Name.ShouldBe("New");
        await using var db = TestDb.Create(_db);
        var saved = await db.Items.SingleAsync();
        saved.Sku.ShouldBe("NEW");
        saved.UnitName.ShouldBe("g");
        saved.IsActive.ShouldBeFalse();
        saved.WarningQuantity.ShouldBe(3m);
        saved.CurrentQuantity.ShouldBe(7m); // update never touches stock
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(AuditAction.ItemUpdated, AuditEntityType.Item, item.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_CostPriceChanged_AddsPriceHistory()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: 5);

        await Handler().Handle(new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", CostPrice = 8 },
            CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var h = await db.ItemPriceHistories.SingleAsync();
        h.ItemId.ShouldBe(item.Id);
        h.OldPrice.ShouldBe(5m);
        h.NewPrice.ShouldBe(8m);
        h.UpdatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Handle_FirstCostPrice_RecordsNullOldPrice()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: null);

        await Handler().Handle(new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", CostPrice = 2 },
            CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ItemPriceHistories.SingleAsync()).OldPrice.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_CostPriceUnchanged_AddsNoHistory()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: 5);

        await Handler().Handle(new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", CostPrice = 5 },
            CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ItemPriceHistories.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_CostPriceOmitted_AddsNoHistoryAndClearsCost()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, cost: 5);

        await Handler().Handle(new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg" },
            CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.ItemPriceHistories.CountAsync()).ShouldBe(0);
        (await db.Items.SingleAsync()).CostPrice.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_SkuUsedByAnotherItem_ThrowsAndLeavesItemUnchanged()
    {
        await ItemSeed.User(_db, _userId);
        await ItemSeed.Item(_db, _userId, name: "Other", sku: "TAKEN");
        var item = await ItemSeed.Item(_db, _userId, name: "Mine", sku: "MINE");

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Mine2", UnitName = "kg", Sku = "TAKEN" }, CancellationToken.None));

        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync(i => i.Id == item.Id)).Name.ShouldBe("Mine");
    }

    [Fact]
    public async Task Handle_KeepingOwnSku_DoesNotThrow()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, sku: "MINE");

        var dto = await Handler().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Renamed", UnitName = "kg", Sku = "MINE" }, CancellationToken.None);
        dto!.Name.ShouldBe("Renamed");
    }

    [Fact]
    public async Task Handle_SwitchingOffAnItemStillUsedByAProduct_IsRefusedLikeDelete()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, name: "Cup");
        var latte = await ItemSeed.Product(_db, _userId, "Latte", "LAT");
        StockSeed.Link(_db, latte.Id, item.Id, 1m);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Cup", UnitName = "kg", IsActive = false }, CancellationToken.None));

        ex.Message.ShouldContain("Latte");
        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).IsActive.ShouldBeTrue();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_SwitchingOffAnUnlinkedItem_ForgetsItsAlertLevelAndLogsADelete()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 1);
        await using (var seed = TestDb.Create(_db))
        {
            (await seed.Items.SingleAsync()).LastAlertStatus = 3;
            await seed.SaveChangesAsync();
        }

        await Handler().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", IsActive = false }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var saved = await db.Items.SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.LastAlertStatus.ShouldBe((byte)0);
        await _audit.Received(1).LogAsync(AuditAction.ItemDeleted, AuditEntityType.Item, item.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_SwitchingAnInactiveItemBackOn_LogsARestore()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, active: false);

        await Handler().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", IsActive = true }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).IsActive.ShouldBeTrue();
        await _audit.Received(1).LogAsync(AuditAction.ItemRestored, AuditEntityType.Item, item.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_PlainEditOfAnInactiveItem_LogsNoRestoreOrDelete()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, active: false);

        await Handler().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Renamed", UnitName = "kg", IsActive = false }, CancellationToken.None);

        await _audit.DidNotReceive().LogAsync(AuditAction.ItemRestored, Arg.Any<AuditEntityType>(), Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
        await _audit.DidNotReceive().LogAsync(AuditAction.ItemDeleted, Arg.Any<AuditEntityType>(), Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }
}
