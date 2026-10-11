using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetDailySalesReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetDailySalesReportHandler Handler(string? timeZone = "Asia/Manila") =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));

    private static GetDailySalesReportQuery Query(
        DateTime from, DateTime to, ReportGroupByEnum? groupBy = null) =>
        new() { FromDate = from, ToDate = to, GroupBy = groupBy };

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 1), new DateTime(2026, 3, 31)), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_OrdersAroundLocalMidnight_AreSplitIntoLocalDays()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 15, 59), 100m); // 23:59 Manila on 3/10
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 200m);  // 00:01 Manila on 3/11
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 11)), default);

        rows.Count.ShouldBe(2);
        rows[0].PeriodStart.ShouldBe(new DateTime(2026, 3, 10));
        rows[0].TotalRevenue.ShouldBe(100m);
        rows[1].PeriodStart.ShouldBe(new DateTime(2026, 3, 11));
        rows[1].TotalRevenue.ShouldBe(200m);
    }

    [Fact]
    public async Task Handle_SameOrdersInUtc_AreGroupedOnTheUtcDay()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 15, 59), 100m);
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 200m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler("UTC").Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 11)), default);

        rows.Count.ShouldBe(1);
        rows[0].PeriodStart.ShouldBe(new DateTime(2026, 3, 10));
        rows[0].TotalRevenue.ShouldBe(300m);
        rows[0].OrderCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_RangeEdges_IncludeLocalStartAndExcludeNextLocalMidnight()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 9, 15, 59, 59), 1m);    // 23:59:59 Manila 3/9 - before
            Sale(db, p, Utc(2026, 3, 9, 16, 0, 0), 10m);     // 00:00 Manila 3/10 - in
            Sale(db, p, Utc(2026, 3, 10, 15, 59, 59), 100m); // 23:59:59 Manila 3/10 - in
            Sale(db, p, Utc(2026, 3, 10, 16, 0, 0), 1000m);  // 00:00 Manila 3/11 - after
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        var row = rows.ShouldHaveSingleItem();
        row.TotalRevenue.ShouldBe(110m);
        row.OrderCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_MixedStatuses_CountsRevenueOnlyForCompletedAndVoidsForCancelledAndRefunded()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = Utc(2026, 3, 10, 4);
            Sale(db, p, at, 100m, Completed, tips: 5m);
            Sale(db, p, at, 300m, Completed, tips: 10m);
            Sale(db, p, at, 999m, Cancelled, tips: 50m);
            Sale(db, p, at, 999m, Refunded, tips: 50m);
            Sale(db, p, at, 999m, Pending, tips: 50m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        var row = rows.ShouldHaveSingleItem();
        row.TotalRevenue.ShouldBe(400m);
        row.OrderCount.ShouldBe(2);
        row.AverageOrderValue.ShouldBe(200m);
        row.TipsTotal.ShouldBe(15m);
        row.VoidCancelledCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_DayWithOnlyCancelledOrders_HasZeroRevenueAndZeroAverage()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 4), 100m, Cancelled);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        var row = rows.ShouldHaveSingleItem();
        row.TotalRevenue.ShouldBe(0m);
        row.OrderCount.ShouldBe(0);
        row.AverageOrderValue.ShouldBe(0m);
        row.VoidCancelledCount.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_OrdersSavedOutOfOrder_AreReturnedByPeriodAscending()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 12, 4), 3m);
            Sale(db, p, Utc(2026, 3, 10, 4), 1m);
            Sale(db, p, Utc(2026, 3, 11, 4), 2m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 12)), default);

        rows.Select(r => r.TotalRevenue).ShouldBe([1m, 2m, 3m]);
    }

    [Fact]
    public async Task Handle_GroupByWeek_StartsWeeksOnMonday()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 8, 4), 1m);    // Sunday 3/8 -> week of Mon 3/2
            Sale(db, p, Utc(2026, 3, 9, 4), 10m);   // Monday 3/9
            Sale(db, p, Utc(2026, 3, 15, 4), 100m); // Sunday 3/15 -> week of Mon 3/9
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(
            Query(new DateTime(2026, 3, 1), new DateTime(2026, 3, 31), ReportGroupByEnum.Week), default);

        rows.Count.ShouldBe(2);
        rows[0].PeriodStart.ShouldBe(new DateTime(2026, 3, 2));
        rows[0].TotalRevenue.ShouldBe(1m);
        rows[1].PeriodStart.ShouldBe(new DateTime(2026, 3, 9));
        rows[1].TotalRevenue.ShouldBe(110m);
    }

    [Fact]
    public async Task Handle_GroupByMonth_BucketsByLocalMonth()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 31, 15, 59), 1m);  // 23:59 Manila 3/31 -> March
            Sale(db, p, Utc(2026, 3, 31, 16, 1), 10m);  // 00:01 Manila 4/1 -> April
            Sale(db, p, Utc(2026, 4, 20, 4), 100m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(
            Query(new DateTime(2026, 3, 1), new DateTime(2026, 4, 30), ReportGroupByEnum.Month), default);

        rows.Count.ShouldBe(2);
        rows[0].PeriodStart.ShouldBe(new DateTime(2026, 3, 1));
        rows[0].TotalRevenue.ShouldBe(1m);
        rows[1].PeriodStart.ShouldBe(new DateTime(2026, 4, 1));
        rows[1].TotalRevenue.ShouldBe(110m);
    }

    [Fact]
    public async Task Handle_NoGroupBy_DefaultsToDay()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 4), 1m);
            Sale(db, p, Utc(2026, 3, 11, 4), 2m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 11), null), default);

        rows.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_OrderWithAddOnsAndBundle_RevenueUsesOrderMetrics()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            var cheese = Product(db, "Cheese", 20m);
            var bacon = Product(db, "Bacon", 30m);
            var promo = Promotion(db, "Combo", 1);
            var order = Order(db, Utc(2026, 3, 10, 4));
            // Parent 100 x2; cheese add-on at product price 20 (its inactive override is ignored); bacon override 5 (not 30).
            var parent = Item(db, order, burger, 2);
            Item(db, order, cheese, 1, parent: parent);
            Item(db, order, bacon, 1, parent: parent);
            Bundle(db, order, promo, 2, 50m);
            db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(), ProductId = burger.Id, AddOnId = bacon.Id, Price = 5m, IsActive = true,
            });
            db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(), ProductId = burger.Id, AddOnId = cheese.Id, Price = 1m, IsActive = false,
            });
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        // (100 + 20 + 5) * 2 + 50 * 2
        rows.ShouldHaveSingleItem().TotalRevenue.ShouldBe(350m);
    }
}
