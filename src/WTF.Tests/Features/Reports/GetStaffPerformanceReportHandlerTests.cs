using WTF.Api.Features.Reports;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetStaffPerformanceReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetStaffPerformanceReportHandler Handler(string? timeZone = "Asia/Manila") =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));

    private static GetStaffPerformanceReportQuery Query(DateTime from, DateTime to, Guid? staffId = null) =>
        new() { FromDate = from, ToDate = to, StaffId = staffId };

    private async Task SeedTwoStaff()
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var p = Product(db, "Burger", 100m);
        var at = Utc(2026, 3, 10, 4);
        Sale(db, p, at, 100m, by: StaffA, tips: 5m);
        Sale(db, p, at, 200m, by: StaffA, tips: 15m);
        Sale(db, p, at, 500m, by: StaffB, tips: 1m);
        Sale(db, p, at, 900m, Cancelled, by: StaffA, tips: 99m);
        Sale(db, p, at, 900m, Refunded, by: StaffB, tips: 99m);
        Sale(db, p, at, 900m, Pending, by: StaffB, tips: 99m);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_MultipleStaff_ReturnsCompletedTotalsOrderedByRevenueDescending()
    {
        await SeedTwoStaff();

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.Count.ShouldBe(2);
        rows[0].StaffId.ShouldBe(StaffB);
        rows[0].StaffName.ShouldBe("Ben Reyes");
        rows[0].OrderCount.ShouldBe(1);
        rows[0].TotalRevenue.ShouldBe(500m);
        rows[0].AverageOrderValue.ShouldBe(500m);
        rows[0].TipsReceived.ShouldBe(1m);
        rows[1].StaffId.ShouldBe(StaffA);
        rows[1].StaffName.ShouldBe("Ana Cruz");
        rows[1].OrderCount.ShouldBe(2);
        rows[1].TotalRevenue.ShouldBe(300m);
        rows[1].AverageOrderValue.ShouldBe(150m);
        rows[1].TipsReceived.ShouldBe(20m);
    }

    [Fact]
    public async Task Handle_StaffFilter_ReturnsOnlyThatStaffMember()
    {
        await SeedTwoStaff();

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10), StaffA), default);

        var row = rows.ShouldHaveSingleItem();
        row.StaffId.ShouldBe(StaffA);
        row.TotalRevenue.ShouldBe(300m);
    }

    [Fact]
    public async Task Handle_StaffFilterWithNoOrders_ReturnsEmptyList()
    {
        await SeedTwoStaff();

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10), Guid.NewGuid()), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_OrdersAroundLocalMidnight_FollowTheRequestTimeZone()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 15, 59), 10m, by: StaffA); // 3/10 Manila
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 20m, by: StaffA);  // 3/11 Manila
            await db.SaveChangesAsync();
        }

        var manila = await Handler("Asia/Manila").Handle(Query(new DateTime(2026, 3, 11), new DateTime(2026, 3, 11)), default);
        var utc = await Handler("UTC").Handle(Query(new DateTime(2026, 3, 11), new DateTime(2026, 3, 11)), default);

        manila.ShouldHaveSingleItem().TotalRevenue.ShouldBe(20m);
        utc.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_OrderWithNullTips_CountsTipsAsZero()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 4), 10m, tips: null);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.ShouldHaveSingleItem().TipsReceived.ShouldBe(0m);
    }
}
