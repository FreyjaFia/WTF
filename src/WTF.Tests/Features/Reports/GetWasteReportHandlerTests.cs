using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Features.Inventory;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetWasteReportHandlerTests
{
    private static readonly DateTime Day1 = Utc(2026, 3, 10, 4);
    private static readonly DateTime Day2 = Utc(2026, 3, 11, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetWasteReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetWasteReportQuery Query(string? groupBy = null, Guid? itemId = null, int? reasonId = null) =>
        new()
        {
            FromDate = new DateTime(2026, 3, 10),
            ToDate = new DateTime(2026, 3, 11),
            GroupBy = groupBy,
            ItemId = itemId,
            WasteReasonId = reasonId
        };

    [Theory]
    [InlineData("month")]
    [InlineData("product")]
    public async Task Handle_UnknownGroupBy_Throws(string groupBy)
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Query(groupBy), default));

        ex.Message.ShouldBe("groupBy must be item, reason, staff or day.");
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("Item", true)]
    [InlineData(" DAY ", true)]
    [InlineData("staff", true)]
    [InlineData("reason", true)]
    [InlineData("week", false)]
    public void IsValidGroupBy_AcceptsKnownValuesOnly(string? groupBy, bool expected)
    {
        GetWasteReportHandler.IsValidGroupBy(groupBy).ShouldBe(expected);
    }

    [Fact]
    public async Task Handle_NoWaste_ReturnsEmpty()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_DefaultGroupBy_GroupsByItemLargestQuantityFirst()
    {
        var seed = Seed();

        var rows = await Handler().Handle(Query(), default);

        rows.Select(r => r.Label).ShouldBe(["Oat Milk", "Cup"]);
        rows[0].GroupKey.ShouldBe(seed.Milk.ToString());
        rows[0].UnitName.ShouldBe("ml");
        rows[0].EntryCount.ShouldBe(2);
        rows[0].Quantity.ShouldBe(300m);
        rows[1].EntryCount.ShouldBe(1);
        rows[1].Quantity.ShouldBe(5m);
    }

    [Fact]
    public async Task Handle_ByReason_OrdersByCountThenLabel()
    {
        var seed = Seed();

        var rows = await Handler().Handle(Query("reason"), default);

        rows.Select(r => r.Label).ShouldBe(["Spilled or dropped", "Expired or spoiled"]);
        rows[0].GroupKey.ShouldBe(seed.Spilled.ToString());
        rows[0].EntryCount.ShouldBe(2);
        rows[0].Quantity.ShouldBe(105m);
        rows[0].UnitName.ShouldBeNull();
        rows[1].Quantity.ShouldBe(200m);
    }

    [Fact]
    public async Task Handle_ByStaff_UsesFullNameAndOrdersByCount()
    {
        var seed = Seed();

        var rows = await Handler().Handle(Query("staff"), default);

        rows.Select(r => r.Label).ShouldBe(["Ana Cruz", "Ben Reyes"]);
        rows[0].GroupKey.ShouldBe(seed.Ana.ToString());
        rows[0].EntryCount.ShouldBe(2);
        rows[1].EntryCount.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_ByDay_UsesShopLocalDayInDateOrder()
    {
        Seed();
        var cup = StockSeed.Item(_dbName, "Lid", 100m);
        var reason = WasteSeed.Reason(_dbName, "Breakage");
        var user = WasteSeed.User(_dbName, AppRoles.Cashier);
        // 23:30 Manila on 10 Mar is 15:30 UTC: still the 10th in the shop.
        WasteSeed.Entry(_dbName, cup, reason, user, 1m, createdAt: Utc(2026, 3, 10, 15, 30), reasonName: "Breakage");

        var rows = await Handler().Handle(Query("day"), default);

        rows.Select(r => r.GroupKey).ShouldBe(["2026-03-10", "2026-03-11"]);
        rows[0].Label.ShouldBe("Mar 10, 2026");
        rows[0].EntryCount.ShouldBe(3);
        rows[0].Quantity.ShouldBe(106m);
        rows[1].EntryCount.ShouldBe(1);
        rows[1].Quantity.ShouldBe(200m);
    }

    [Fact]
    public async Task Handle_ReversedWaste_IsLeftOut()
    {
        var seed = Seed();
        WasteSeed.Entry(_dbName, seed.Milk, seed.Spilled, seed.Ana, 999m, StockWasteStatuses.Reversed, Day1);

        var rows = await Handler().Handle(Query(), default);

        rows.Single(r => r.Label == "Oat Milk").Quantity.ShouldBe(300m);
    }

    [Fact]
    public async Task Handle_PendingConfirmedAndDisputedWaste_AreCounted()
    {
        var seed = Seed();
        WasteSeed.Entry(_dbName, seed.Cup, seed.Spilled, seed.Ana, 1m, StockWasteStatuses.PendingReview, Day1);
        WasteSeed.Entry(_dbName, seed.Cup, seed.Spilled, seed.Ana, 1m, StockWasteStatuses.Confirmed, Day1);
        WasteSeed.Entry(_dbName, seed.Cup, seed.Spilled, seed.Ana, 1m, StockWasteStatuses.Disputed, Day1);

        var rows = await Handler().Handle(Query(), default);

        rows.Single(r => r.Label == "Cup").EntryCount.ShouldBe(4);
        rows.Single(r => r.Label == "Cup").Quantity.ShouldBe(8m);
    }

    [Fact]
    public async Task Handle_RefundWasteMovement_IsLeftOut()
    {
        var seed = Seed();
        await using (var db = TestDb.Create(_dbName))
        {
            db.StockMovements.Add(new StockMovement
            {
                Id = Guid.NewGuid(),
                ItemId = seed.Milk,
                MovementType = StockMovementTypes.Waste,
                QuantityDelta = -500m,
                QuantityBefore = 1000m,
                QuantityAfter = 500m,
                ReferenceType = "Order",
                ReferenceId = Guid.NewGuid(),
                Notes = "Refunded, not resaleable",
                CreatedAt = Day1,
                CreatedBy = seed.Ana
            });
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.Single(r => r.Label == "Oat Milk").Quantity.ShouldBe(300m);
    }

    [Fact]
    public async Task Handle_OutsideRange_IsLeftOut()
    {
        var seed = Seed();
        WasteSeed.Entry(_dbName, seed.Cup, seed.Spilled, seed.Ana, 50m, createdAt: Utc(2026, 3, 12, 4));
        WasteSeed.Entry(_dbName, seed.Cup, seed.Spilled, seed.Ana, 50m, createdAt: Utc(2026, 3, 9, 4));

        var rows = await Handler().Handle(Query(), default);

        rows.Single(r => r.Label == "Cup").Quantity.ShouldBe(5m);
    }

    [Fact]
    public async Task Handle_ItemAndReasonFilters_NarrowTheRows()
    {
        var seed = Seed();

        var byItem = await Handler().Handle(Query("reason", itemId: seed.Milk), default);
        var byReason = await Handler().Handle(Query(reasonId: seed.Spilled), default);

        byItem.Select(r => r.Label).ShouldBe(["Expired or spoiled", "Spilled or dropped"]);
        byItem.Sum(r => r.Quantity).ShouldBe(300m);
        byReason.Select(r => r.Label).ShouldBe(["Oat Milk", "Cup"]);
        byReason.Sum(r => r.Quantity).ShouldBe(105m);
    }

    private (Guid Milk, Guid Cup, int Spilled, int Expired, Guid Ana, Guid Ben) Seed()
    {
        var milk = StockSeed.Item(_dbName, "Oat Milk", 1000m);
        var cup = StockSeed.Item(_dbName, "Cup", 100m);
        var spilled = WasteSeed.Reason(_dbName, "Spilled or dropped");
        var expired = WasteSeed.Reason(_dbName, "Expired or spoiled");
        var ana = WasteSeed.User(_dbName, AppRoles.Cashier, first: "Ana", last: "Cruz");
        var ben = WasteSeed.User(_dbName, AppRoles.StockManager, first: "Ben", last: "Reyes");

        WasteSeed.Entry(_dbName, milk, spilled, ana, 100m, createdAt: Day1, reasonName: "Spilled or dropped");
        WasteSeed.Entry(_dbName, milk, expired, ben, 200m, createdAt: Day2, reasonName: "Expired or spoiled");
        WasteSeed.Entry(_dbName, cup, spilled, ana, 5m, createdAt: Day1, reasonName: "Spilled or dropped");

        return (milk, cup, spilled, expired, ana, ben);
    }
}
