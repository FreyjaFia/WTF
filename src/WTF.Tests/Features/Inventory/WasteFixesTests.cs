using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Notifications;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class WasteFixesTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    public WasteFixesTests()
    {
        WasteSeed.User(_db, AppRoles.Cashier, id: _userId, first: "Cara", last: "Cashier");
    }

    [Fact]
    public async Task PosWasteItems_ReturnsActiveItemsByNameWithoutCost()
    {
        var oat = StockSeed.Item(_db, "Oat Milk", 900m, allowNegative: false, cost: 0.15m);
        var cup = StockSeed.Item(_db, "Cup", 40m);
        StockSeed.Item(_db, "Retired Syrup", 10m, active: false);
        WasteSeed.SetApprovalLimit(_db, oat, 500m);

        var result = await new GetPosWasteItemsHandler(TestDb.Create(_db)).Handle(new GetPosWasteItemsQuery(), default);

        result.Select(i => i.Name).ShouldBe(["Cup", "Oat Milk"]);
        var milk = result.Single(i => i.Id == oat);
        milk.BaseUnit.ShouldBe("ml");
        milk.CurrentQuantity.ShouldBe(900m);
        milk.AllowNegativeStock.ShouldBeFalse();
        milk.WasteApprovalLimit.ShouldBe(500m);
        result.Single(i => i.Id == cup).WasteApprovalLimit.ShouldBeNull();
        typeof(WTF.Api.Features.Inventory.Waste.DTOs.PosWasteItemDto).GetProperties()
            .Select(p => p.Name)
            .ShouldNotContain(n => n.Contains("Cost"));
    }

    [Fact]
    public async Task Record_RetryWithSameClientRequestId_ReturnsSameEntryAndDeductsOnce()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db, "Spilled or dropped");
        var requestId = Guid.NewGuid();
        var command = new RecordWasteCommand(itemId, 200m, reasonId, null, null, requestId);

        var first = await Handler().Handle(command, default);
        var retry = await Handler().Handle(command, default);

        first.ShouldNotBeNull();
        retry.ShouldNotBeNull();
        retry.Id.ShouldBe(first.Id);
        StockSeed.Balance(_db, itemId).ShouldBe(800m);
        StockSeed.Movements(_db, itemId).Count.ShouldBe(1);
        TestDb.Create(_db).StockWastes.Count().ShouldBe(1);
    }

    [Fact]
    public async Task Record_DifferentClientRequestIds_RecordTwice()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db, "Spilled or dropped");

        await Handler().Handle(new RecordWasteCommand(itemId, 200m, reasonId, null, null, Guid.NewGuid()), default);
        await Handler().Handle(new RecordWasteCommand(itemId, 200m, reasonId, null, null, Guid.NewGuid()), default);

        StockSeed.Balance(_db, itemId).ShouldBe(600m);
        TestDb.Create(_db).StockWastes.Count().ShouldBe(2);
    }

    [Fact]
    public async Task List_DateFilter_UsesShopLocalDay()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db, "Spilled or dropped");

        // Manila is UTC+8: 10 Mar local runs from 9 Mar 16:00 UTC to 10 Mar 16:00 UTC.
        WasteSeed.Entry(_db, itemId, reasonId, _userId, createdAt: new DateTime(2026, 3, 9, 15, 59, 0, DateTimeKind.Utc));
        var earlyMorning = WasteSeed.Entry(_db, itemId, reasonId, _userId, createdAt: new DateTime(2026, 3, 9, 16, 0, 0, DateTimeKind.Utc));
        var lateEvening = WasteSeed.Entry(_db, itemId, reasonId, _userId, createdAt: new DateTime(2026, 3, 10, 15, 30, 0, DateTimeKind.Utc));
        WasteSeed.Entry(_db, itemId, reasonId, _userId, createdAt: new DateTime(2026, 3, 10, 16, 0, 0, DateTimeKind.Utc));

        var day = new DateTime(2026, 3, 10);
        var handler = new GetStockWastesHandler(TestDb.Create(_db), TestRequest.As(_userId, timeZone: "Asia/Manila"));
        var result = await handler.Handle(new GetStockWastesQuery(day, day, null, null, null, null), default);

        result.Items.Select(i => i.Id).OrderBy(i => i).ShouldBe(new[] { earlyMorning, lateEvening }.OrderBy(i => i));
    }

    private RecordWasteHandler Handler() =>
        new(
            TestDb.Create(_db),
            TestRequest.As(_userId, AppRoles.Cashier),
            TestFakes.Audit(),
            Substitute.For<IStockAlertService>(),
            Substitute.For<INotificationService>());
}
