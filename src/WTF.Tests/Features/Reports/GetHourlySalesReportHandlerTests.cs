using WTF.Api.Features.Reports;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetHourlySalesReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetHourlySalesReportHandler Handler(string? timeZone = "Asia/Manila") =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));

    private static GetHourlySalesReportQuery Query(DateTime from, DateTime to) =>
        new() { FromDate = from, ToDate = to };

    [Fact]
    public async Task Handle_NoOrders_Returns24ZeroRows()
    {
        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.Count.ShouldBe(24);
        rows.Select(r => r.Hour).ShouldBe(Enumerable.Range(0, 24));
        rows.ShouldAllBe(r => r.OrderCount == 0 && r.Revenue == 0m);
    }

    [Fact]
    public async Task Handle_OrdersAroundLocalHourBoundary_AreBucketedByLocalHour()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 15, 59), 10m); // 23:59 Manila -> hour 23
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 20m);  // 00:01 Manila next day -> hour 0
            Sale(db, p, Utc(2026, 3, 10, 16, 30), 5m);  // hour 0
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 11)), default);

        rows[23].OrderCount.ShouldBe(1);
        rows[23].Revenue.ShouldBe(10m);
        rows[0].OrderCount.ShouldBe(2);
        rows[0].Revenue.ShouldBe(25m);
        rows.Sum(r => r.OrderCount).ShouldBe(3);
    }

    [Fact]
    public async Task Handle_SameOrdersInUtc_UseUtcHours()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 15, 59), 10m);
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 20m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler("UTC").Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows[15].Revenue.ShouldBe(10m);
        rows[16].Revenue.ShouldBe(20m);
    }

    [Fact]
    public async Task Handle_OnlyCompletedOrdersWithinRange_AreCounted()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = Utc(2026, 3, 10, 2); // 10:00 Manila
            Sale(db, p, at, 10m);
            Sale(db, p, at, 20m);
            Sale(db, p, at, 999m, Cancelled);
            Sale(db, p, at, 999m, Refunded);
            Sale(db, p, at, 999m, Pending);
            Sale(db, p, Utc(2026, 3, 10, 16, 0), 999m); // 00:00 Manila 3/11, outside a 3/10 range
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows[10].OrderCount.ShouldBe(2);
        rows[10].Revenue.ShouldBe(30m);
        rows.Sum(r => r.OrderCount).ShouldBe(2);
    }

    [Fact]
    public async Task Handle_MultiDayRange_AddsSameHourAcrossDays()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 2), 10m);
            Sale(db, p, Utc(2026, 3, 11, 2), 15m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 11)), default);

        rows[10].OrderCount.ShouldBe(2);
        rows[10].Revenue.ShouldBe(25m);
    }
}
