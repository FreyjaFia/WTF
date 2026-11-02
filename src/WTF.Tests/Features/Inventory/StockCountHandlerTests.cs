using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Counts;
using WTF.Tests.Features.Items;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class StockCountHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private StartStockCountHandler Start() => new(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

    private SaveStockCountLinesHandler Save() => new(TestDb.Create(_db), TestRequest.As(_userId));

    private PostStockCountHandler Post() => new(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit(), TestFakes.Alerts(TestDb.Create(_db)));

    private CancelStockCountHandler Cancel() => new(TestDb.Create(_db), TestRequest.As(_userId), TestFakes.Audit());

    private static StockCountEntry Entry(Guid itemId, decimal? counted) => new(itemId, counted);

    private async Task<StockCountDto> Started(bool blind = false, List<Guid>? itemIds = null) =>
        await Start().Handle(new StartStockCountCommand { Name = " Milk shelf ", IsBlind = blind, ItemIds = itemIds }, CancellationToken.None);

    private Task<StockCountDto?> Saved(Guid countId, params StockCountEntry[] entries) =>
        Save().Handle(new SaveStockCountLinesCommand { CountId = countId, Lines = [.. entries] }, CancellationToken.None);

    [Fact]
    public async Task Start_WithNoItemIds_CountsEveryActiveItem()
    {
        await ItemSeed.User(_db, _userId);
        await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        await ItemSeed.Item(_db, _userId, "Beans", qty: 5);
        await ItemSeed.Item(_db, _userId, "Old", qty: 1, active: false);

        var count = await Started();

        count.Summary.Name.ShouldBe("Milk shelf");
        count.Summary.Status.ShouldBe(StockCountStatuses.Open);
        count.Lines.Select(l => l.ItemName).ShouldBe(["Beans", "Milk"]);
    }

    [Fact]
    public async Task Start_WithAnInactiveChosenItem_IsRefused()
    {
        await ItemSeed.User(_db, _userId);
        var old = await ItemSeed.Item(_db, _userId, "Old", qty: 1, active: false);

        await Should.ThrowAsync<InvalidOperationException>(() => Started(itemIds: [old.Id]));
    }

    [Fact]
    public async Task Save_RecordsTheCountAndTheBalanceShownAtThatMoment()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();

        var saved = await Saved(count.Summary.Id, Entry(milk.Id, 7m));

        var line = saved!.Lines.Single();
        line.CountedQuantity.ShouldBe(7m);
        line.ExpectedQuantity.ShouldBe(10m);
        line.Difference.ShouldBe(-3m);
        saved.Summary.CountedCount.ShouldBe(1);
    }

    [Fact]
    public async Task Save_OnABlindCount_HidesTheExpectedBalanceUntilItIsPosted()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started(blind: true);

        var saved = await Saved(count.Summary.Id, Entry(milk.Id, 7m));
        saved!.Lines.Single().ExpectedQuantity.ShouldBeNull();
        saved.Lines.Single().Difference.ShouldBeNull();

        var posted = await Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None);
        posted!.Lines.Single().ExpectedQuantity.ShouldBe(10m);
        posted.Lines.Single().Difference.ShouldBe(-3m);
    }

    [Fact]
    public async Task Save_WithNullClearsTheLine()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();
        await Saved(count.Summary.Id, Entry(milk.Id, 7m));

        var cleared = await Saved(count.Summary.Id, Entry(milk.Id, null));

        cleared!.Lines.Single().CountedQuantity.ShouldBeNull();
        cleared.Summary.CountedCount.ShouldBe(0);
    }

    [Fact]
    public async Task Save_AnItemOutsideTheCount_IsRefused()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var beans = await ItemSeed.Item(_db, _userId, "Beans", qty: 10);
        var count = await Started(itemIds: [milk.Id]);

        await Should.ThrowAsync<InvalidOperationException>(() => Saved(count.Summary.Id, Entry(beans.Id, 1m)));
    }

    [Fact]
    public async Task Save_UnknownCount_ReturnsNull()
    {
        (await Saved(Guid.NewGuid(), Entry(Guid.NewGuid(), 1m))).ShouldBeNull();
    }

    [Fact]
    public async Task Post_WritesACountMovementForEachDifferenceOnly()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var beans = await ItemSeed.Item(_db, _userId, "Beans", qty: 5);
        var count = await Started();
        await Saved(count.Summary.Id, Entry(milk.Id, 7m), Entry(beans.Id, 5m));

        var posted = await Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None);

        posted!.Summary.Status.ShouldBe(StockCountStatuses.Posted);
        await using var db = TestDb.Create(_db);
        var movement = await db.StockMovements.SingleAsync();
        movement.MovementType.ShouldBe("Count");
        movement.ItemId.ShouldBe(milk.Id);
        movement.QuantityDelta.ShouldBe(-3m);
        movement.ReferenceType.ShouldBe("StockCount");
        movement.ReferenceId.ShouldBe(count.Summary.Id);
        (await db.Items.SingleAsync(i => i.Id == milk.Id)).CurrentQuantity.ShouldBe(7m);
        (await db.Items.SingleAsync(i => i.Id == beans.Id)).CurrentQuantity.ShouldBe(5m);
        posted.Lines.Single(l => l.ItemId == milk.Id).AdjustmentPosted.ShouldBeTrue();
        posted.Lines.Single(l => l.ItemId == beans.Id).AdjustmentPosted.ShouldBeFalse();
    }

    [Fact]
    public async Task Post_AppliesTheDifferenceOnTopSoSalesAfterTheCountAreKept()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();
        await Saved(count.Summary.Id, Entry(milk.Id, 8m));

        await using (var db = TestDb.Create(_db))
        {
            (await db.Items.SingleAsync()).CurrentQuantity = 6m;
            await db.SaveChangesAsync();
        }

        await Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None);

        await using var check = TestDb.Create(_db);
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(4m);
    }

    [Fact]
    public async Task Post_WithNothingCounted_IsRefused()
    {
        await ItemSeed.User(_db, _userId);
        await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();

        await Should.ThrowAsync<InvalidOperationException>(
            () => Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None));
    }

    [Fact]
    public async Task Post_ACountThatIsAlreadyPosted_IsRefusedAndAppliesNothingTwice()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();
        await Saved(count.Summary.Id, Entry(milk.Id, 7m));
        await Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(
            () => Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None));

        await using var db = TestDb.Create(_db);
        (await db.StockMovements.CountAsync()).ShouldBe(1);
        (await db.Items.SingleAsync()).CurrentQuantity.ShouldBe(7m);
    }

    [Fact]
    public async Task Post_AnItemDeletedAfterCounting_IsSkipped()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();
        await Saved(count.Summary.Id, Entry(milk.Id, 7m));
        await using (var db = TestDb.Create(_db))
        {
            (await db.Items.SingleAsync()).IsActive = false;
            await db.SaveChangesAsync();
        }

        await Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None);

        await using var check = TestDb.Create(_db);
        (await check.StockMovements.CountAsync()).ShouldBe(0);
        (await check.Items.SingleAsync()).CurrentQuantity.ShouldBe(10m);
    }

    [Fact]
    public async Task Cancel_ClosesTheCountWithoutTouchingStock_AndItCannotBeSavedAfter()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var count = await Started();
        await Saved(count.Summary.Id, Entry(milk.Id, 7m));

        var cancelled = await Cancel().Handle(new CancelStockCountCommand(count.Summary.Id), CancellationToken.None);

        cancelled!.Summary.Status.ShouldBe(StockCountStatuses.Cancelled);
        await Should.ThrowAsync<InvalidOperationException>(() => Saved(count.Summary.Id, Entry(milk.Id, 1m)));
        await Should.ThrowAsync<InvalidOperationException>(
            () => Post().Handle(new PostStockCountCommand(count.Summary.Id), CancellationToken.None));
        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).CurrentQuantity.ShouldBe(10m);
    }

    [Fact]
    public async Task List_ReturnsCountsNewestFirstWithProgress()
    {
        await ItemSeed.User(_db, _userId);
        var milk = await ItemSeed.Item(_db, _userId, "Milk", qty: 10);
        var first = await Started();
        await Saved(first.Summary.Id, Entry(milk.Id, 7m));

        var list = await new GetStockCountsHandler(TestDb.Create(_db)).Handle(new GetStockCountsQuery(), CancellationToken.None);

        list.Single().LineCount.ShouldBe(1);
        list.Single().CountedCount.ShouldBe(1);
    }
}
