using WTF.Api.Features.Dashboard;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Dashboard;

/// <summary>
/// The handler reads DateTime.UtcNow, so every date here is derived from the same clock, in the request time zone.
/// Orders are seeded on past days, so the assertions hold whatever the time of day.
/// </summary>
public class GetDashboardHandlerTests
{
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    private readonly string _dbName = TestDb.NewName();

    private GetDashboardHandler Handler(string? timeZone = "Asia/Manila") =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));

    private static DateTime LocalToday(TimeZoneInfo? tz = null) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz ?? Manila).Date;

    /// <summary>The UTC instant of a local wall-clock time in the given zone.</summary>
    private static DateTime At(DateTime localDate, int hour, int minute = 0, TimeZoneInfo? tz = null) =>
        TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localDate.Date.AddHours(hour).AddMinutes(minute), DateTimeKind.Unspecified),
            tz ?? Manila);

    private static GetDashboardQuery Preset(string? preset) => new(preset, null, null);

    [Fact]
    public async Task Handle_NoData_ReturnsZeroedTodayDashboard()
    {
        var before = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Manila).Hour;

        var dto = await Handler().Handle(Preset(null), default);

        var after = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Manila).Hour;
        dto.Today.TotalOrders.ShouldBe(0);
        dto.Today.TotalRevenue.ShouldBe(0m);
        dto.Today.AverageOrderValue.ShouldBe(0m);
        dto.Today.TotalCustomers.ShouldBe(0);
        dto.TopSellingProducts.ShouldBeEmpty();
        dto.RecentOrders.ShouldBeEmpty();
        dto.PaymentMethods.ShouldBeEmpty();
        dto.OrdersByStatus.ShouldBe(new WTF.Api.Features.Dashboard.DTOs.OrdersByStatusDto(0, 0, 0, 0));
        dto.ComparisonLabel.ShouldBe("vs Yesterday");
        dto.DailyRevenue.ShouldBeNull();
        // A partial day only lists hours up to the current local hour.
        dto.HourlyRevenue.Count.ShouldBeInRange(before + 1, after + 1);
        dto.HourlyRevenue.Select(h => h.Hour).ShouldBe(Enumerable.Range(0, dto.HourlyRevenue.Count));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nonsense")]
    [InlineData("custom")]
    public async Task Handle_UnknownOrIncompletePreset_FallsBackToToday(string? preset)
    {
        var dto = await Handler().Handle(Preset(preset), default);

        dto.ComparisonLabel.ShouldBe("vs Yesterday");
        dto.DailyRevenue.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_TodayPreset_ComparesAgainstYesterdayInLocalTime()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(yesterday, 23, 59), 100m, tips: 4m);
            Sale(db, p, At(yesterday, 0, 1), 50m, tips: 1m);
            Sale(db, p, At(yesterday.AddDays(-1), 23, 59), 7000m); // two days ago: not in the comparison
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("today"), default);

        dto.Today.TotalOrders.ShouldBe(0);
        dto.Today.YesterdayTotalOrders.ShouldBe(2);
        dto.Today.YesterdayTotalRevenue.ShouldBe(150m);
        dto.Today.YesterdayAverageOrderValue.ShouldBe(75m);
        dto.Today.YesterdayTotalTips.ShouldBe(5m);
    }

    [Fact]
    public async Task Handle_YesterdayPreset_UsesLocalDayEdgesAnd24Hours()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(yesterday, 23, 59), 100m);
            Sale(db, p, At(yesterday, 0, 1), 10m);
            Sale(db, p, At(yesterday.AddDays(1), 0, 1), 5000m);   // today: excluded
            Sale(db, p, At(yesterday.AddDays(-1), 23, 59), 700m); // day before: comparison only
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("yesterday"), default);

        dto.ComparisonLabel.ShouldBe("vs Day Before");
        dto.Today.TotalOrders.ShouldBe(2);
        dto.Today.TotalRevenue.ShouldBe(110m);
        dto.Today.YesterdayTotalOrders.ShouldBe(1);
        dto.Today.YesterdayTotalRevenue.ShouldBe(700m);
        dto.DailyRevenue.ShouldBeNull();
        dto.HourlyRevenue.Count.ShouldBe(24);
        dto.HourlyRevenue[23].Revenue.ShouldBe(100m);
        dto.HourlyRevenue[23].Orders.ShouldBe(1);
        dto.HourlyRevenue[0].Revenue.ShouldBe(10m);
        dto.HourlyRevenue.Sum(h => h.Orders).ShouldBe(2);
    }

    [Fact]
    public async Task Handle_PresetIsCaseInsensitive()
    {
        var dto = await Handler().Handle(Preset("YesterDay"), default);

        dto.ComparisonLabel.ShouldBe("vs Day Before");
    }

    [Fact]
    public async Task Handle_YesterdayInUtc_BucketsByUtcDayAndHour()
    {
        var utc = TimeZoneInfo.Utc;
        var yesterday = LocalToday(utc).AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(yesterday, 23, 30, utc), 100m);
            Sale(db, p, At(yesterday.AddDays(1), 0, 30, utc), 9000m); // today in UTC
            await db.SaveChangesAsync();
        }

        var dto = await Handler("UTC").Handle(Preset("yesterday"), default);

        dto.Today.TotalOrders.ShouldBe(1);
        dto.HourlyRevenue[23].Revenue.ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_MixedStatuses_SummaryAndStatusBreakdownFollowTheirOwnRules()
    {
        var yesterday = LocalToday().AddDays(-1);
        var customer = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = At(yesterday, 12);
            var done = Sale(db, p, at, 100m, Completed, tips: 5m);
            done.CustomerId = customer;
            var second = Sale(db, p, at, 100m, Completed, tips: 5m);
            second.CustomerId = customer; // the same customer twice counts once
            Sale(db, p, at, 40m, Cancelled, tips: 1m).CustomerId = Guid.NewGuid();
            Sale(db, p, at, 40m, Refunded, tips: 2m);
            Sale(db, p, at, 40m, Pending, tips: 3m);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("yesterday"), default);

        dto.Today.TotalOrders.ShouldBe(5);                 // every status
        dto.Today.TotalRevenue.ShouldBe(200m);             // completed only
        dto.Today.AverageOrderValue.ShouldBe(100m);        // revenue / completed orders, as in the reports
        dto.Today.TotalTips.ShouldBe(10m);                 // completed only
        dto.Today.TotalCustomers.ShouldBe(2);
        dto.OrdersByStatus.Pending.ShouldBe(1);
        dto.OrdersByStatus.Completed.ShouldBe(2);
        dto.OrdersByStatus.Cancelled.ShouldBe(1);
        dto.OrdersByStatus.Refunded.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_Last7Days_ReturnsSevenDailyPointsAndComparesThePreviousSevenDays()
    {
        var today = LocalToday();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(today.AddDays(-6), 0, 1), 10m);   // first local minute of the window
            Sale(db, p, At(today.AddDays(-1), 12), 20m);
            Sale(db, p, At(today.AddDays(-7), 23, 59), 300m); // comparison window
            Sale(db, p, At(today.AddDays(-13), 0, 1), 400m);  // comparison window
            Sale(db, p, At(today.AddDays(-14), 23, 59), 9000m); // outside both
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("last7days"), default);

        dto.ComparisonLabel.ShouldBe("vs Prev. 7 Days");
        dto.HourlyRevenue.ShouldBeEmpty();
        dto.DailyRevenue.ShouldNotBeNull();
        dto.DailyRevenue!.Select(d => d.Date).ShouldBe(Enumerable.Range(-6, 7).Select(i => today.AddDays(i)));
        dto.DailyRevenue[0].Revenue.ShouldBe(10m);
        dto.DailyRevenue[5].Revenue.ShouldBe(20m);
        dto.Today.TotalOrders.ShouldBe(2);
        dto.Today.TotalRevenue.ShouldBe(30m);
        dto.Today.YesterdayTotalOrders.ShouldBe(2);
        dto.Today.YesterdayTotalRevenue.ShouldBe(700m);
    }

    [Fact]
    public async Task Handle_Last30Days_ReturnsThirtyDailyPointsWithTheRightLabel()
    {
        var dto = await Handler().Handle(Preset("last30days"), default);

        dto.ComparisonLabel.ShouldBe("vs Prev. 30 Days");
        dto.DailyRevenue.ShouldNotBeNull();
        dto.DailyRevenue!.Count.ShouldBe(30);
        dto.DailyRevenue.ShouldAllBe(d => d.Revenue == 0m && d.Orders == 0);
    }

    [Fact]
    public async Task Handle_CustomMultiDayRange_ComparesTheEquallyLongPeriodBefore()
    {
        var start = new DateTime(2026, 3, 10);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(start, 0, 1), 1m);
            Sale(db, p, At(start.AddDays(2), 23, 59), 4m);
            Sale(db, p, At(start.AddDays(3), 0, 1), 9000m);   // after the range
            Sale(db, p, At(start.AddDays(-1), 23, 59), 50m);  // comparison
            Sale(db, p, At(start.AddDays(-3), 0, 1), 60m);    // comparison
            Sale(db, p, At(start.AddDays(-4), 23, 59), 9000m); // before the comparison
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(
            new GetDashboardQuery("custom", new DateTime(2026, 3, 10, 15, 0, 0), new DateTime(2026, 3, 12, 9, 0, 0)), default);

        dto.ComparisonLabel.ShouldBe("vs Prev. Period");
        dto.HourlyRevenue.ShouldBeEmpty();
        dto.DailyRevenue.ShouldNotBeNull();
        dto.DailyRevenue!.Select(d => d.Date).ShouldBe([start, start.AddDays(1), start.AddDays(2)]);
        dto.DailyRevenue.Select(d => d.Revenue).ShouldBe([1m, 0m, 4m]);
        dto.Today.TotalOrders.ShouldBe(2);
        dto.Today.YesterdayTotalOrders.ShouldBe(2);
        dto.Today.YesterdayTotalRevenue.ShouldBe(110m);
    }

    [Fact]
    public async Task Handle_CustomSingleDayInThePast_IsTreatedAsAHourlyView()
    {
        var day = LocalToday().AddDays(-10);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(day, 13, 30), 25m);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(new GetDashboardQuery("custom", day, day), default);

        dto.DailyRevenue.ShouldBeNull();
        dto.HourlyRevenue.Count.ShouldBe(24);
        dto.HourlyRevenue[13].Revenue.ShouldBe(25m);
        dto.ComparisonLabel.ShouldBe("vs Prev. Period");
    }

    [Fact]
    public async Task Handle_DailyRevenuePoints_CountAllOrdersButRevenueOnlyForCompleted()
    {
        var today = LocalToday();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = At(today.AddDays(-2), 12);
            Sale(db, p, at, 100m, tips: 3m);
            Sale(db, p, at, 80m, Cancelled, tips: 2m);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("last7days"), default);

        var point = dto.DailyRevenue!.Single(d => d.Date == today.AddDays(-2));
        point.Revenue.ShouldBe(100m);
        point.Orders.ShouldBe(2);
        point.Tips.ShouldBe(3m); // the cancelled order's tip is not income
    }

    [Fact]
    public async Task Handle_TopProducts_ReturnsFiveBestByQuantityIncludingBundlesAndAddOns()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var order = Order(db, At(yesterday, 12));
            for (var i = 1; i <= 6; i++)
            {
                Item(db, order, Product(db, $"P{i}", 10m), i * 10);
            }

            // Burger x2 (qty 2, below the cut off) with a 5 add-on: (50 + 5) * 2
            var cheese = Product(db, "Cheese", 5m);
            var burger = Product(db, "Burger", 50m);
            var parent = Item(db, order, burger, 2);
            Item(db, order, cheese, 1, parent: parent);

            // A bundle sold 100 times outranks every product.
            var combo = Promotion(db, "Combo", 1);
            Bundle(db, order, combo, 100, 3m);

            // Non-completed orders never count.
            var cancelled = Order(db, At(yesterday, 12), Cancelled);
            Item(db, cancelled, Product(db, "Ghost", 1m), 1000);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("yesterday"), default);

        dto.TopSellingProducts.Select(t => t.ProductName).ShouldBe(["Combo", "P6", "P5", "P4", "P3"]);
        dto.TopSellingProducts[0].QuantitySold.ShouldBe(100);
        dto.TopSellingProducts[0].Revenue.ShouldBe(300m);
        dto.TopSellingProducts[1].Revenue.ShouldBe(600m);
        dto.TopSellingProducts.ShouldAllBe(t => t.ImageUrl == null);
    }

    [Fact]
    public async Task Handle_TopProducts_IncludeAddOnRevenueInTheParentProduct()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var order = Order(db, At(yesterday, 12));
            var cheese = Product(db, "Cheese", 5m);
            var burger = Product(db, "Burger", 50m);
            var parent = Item(db, order, burger, 2);
            Item(db, order, cheese, 1, parent: parent);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("yesterday"), default);

        var top = dto.TopSellingProducts.ShouldHaveSingleItem();
        top.ProductName.ShouldBe("Burger");
        top.QuantitySold.ShouldBe(2);
        top.Revenue.ShouldBe(110m);
    }

    [Fact]
    public async Task Handle_RecentOrders_ReturnsFiveNewestOfAnyStatusWithinTheRange()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, At(yesterday, 8), 1m);              // oldest, falls off the top five
            Sale(db, p, At(yesterday, 9), 2m, Pending);
            Sale(db, p, At(yesterday, 10), 3m, Cancelled);
            Sale(db, p, At(yesterday, 11), 4m, Refunded);
            Sale(db, p, At(yesterday, 12), 5m);
            Sale(db, p, At(yesterday, 13), 6m);
            Sale(db, p, At(yesterday.AddDays(1), 0, 1), 999m); // today: outside the range
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("yesterday"), default);

        dto.RecentOrders.Select(o => o.TotalAmount).ShouldBe([6m, 5m, 4m, 3m, 2m]);
        dto.RecentOrders.Select(o => o.StatusName).ShouldBe(["Completed", "Completed", "Refunded", "Cancelled", "Pending"]);
        dto.RecentOrders[0].StatusId.ShouldBe(Completed);
    }

    [Fact]
    public async Task Handle_PaymentMethods_CountsCompletedOrdersWithAMethodOrderedByTotal()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = At(yesterday, 12);
            Sale(db, p, at, 10m, payment: Cash);
            Sale(db, p, at, 15m, payment: Cash);
            Sale(db, p, at, 100m, payment: Card);
            Sale(db, p, at, 500m, payment: null);            // no method: not listed
            Sale(db, p, at, 500m, Cancelled, payment: Card); // not completed
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Preset("yesterday"), default);

        dto.PaymentMethods.Count.ShouldBe(2);
        dto.PaymentMethods[0].Name.ShouldBe("Card");
        dto.PaymentMethods[0].Count.ShouldBe(1);
        dto.PaymentMethods[0].Total.ShouldBe(100m);
        dto.PaymentMethods[1].Name.ShouldBe("Cash");
        dto.PaymentMethods[1].Count.ShouldBe(2);
        dto.PaymentMethods[1].Total.ShouldBe(25m);
    }
}
