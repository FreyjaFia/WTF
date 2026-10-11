using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

/// <summary>Every report can be limited to orders the shop took itself or orders customers placed through their link.</summary>
public class ReportSourceFilterTests
{
    private static readonly DateTime Day = new(2026, 3, 10);
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private static byte Of(OrderSourceEnum source) => (byte)source;

    /// <summary>Shop: 100 and 200 completed, 900 cancelled. Customer link: 300 completed (cash), 50 completed (card),
    /// 700 cancelled. Bundles and tips on both sides.</summary>
    private async Task Seed()
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var burger = Product(db, "Burger", 100m, FoodCategory, BurgerSub);
        var cola = Product(db, "Cola", 20m, DrinksCategory);

        Sale(db, burger, Noon, 100m, tips: 5m);
        Sale(db, burger, Noon, 200m, by: StaffB, tips: 10m);
        Sale(db, burger, Noon, 900m, Cancelled);

        Sale(db, cola, Noon, 300m, tips: 20m).Source = Of(OrderSourceEnum.CustomerLink);
        Sale(db, cola, Noon, 50m, payment: Card, by: StaffB).Source = Of(OrderSourceEnum.CustomerLink);
        Sale(db, cola, Noon, 700m, Cancelled).Source = Of(OrderSourceEnum.CustomerLink);

        var fixedBundle = Promotion(db, "Combo", 1);
        var shopBundle = Order(db, Noon);
        Bundle(db, shopBundle, fixedBundle, 1, 60m);
        var linkBundle = Order(db, Noon);
        linkBundle.Source = Of(OrderSourceEnum.CustomerLink);
        Bundle(db, linkBundle, fixedBundle, 2, 60m);

        await db.SaveChangesAsync();
    }

    private GetDailySalesReportHandler Daily() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private GetHourlySalesReportHandler Hourly() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private GetPaymentsReportHandler Payments() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private GetStaffPerformanceReportHandler Staff() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private GetProductSalesReportHandler Products() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    // --- daily sales ---

    [Theory]
    [InlineData(null, 100 + 200 + 60 + 300 + 50 + 120, 6, 2)]
    [InlineData(OrderSourceEnum.Pos, 100 + 200 + 60, 3, 1)]
    [InlineData(OrderSourceEnum.CustomerLink, 300 + 50 + 120, 3, 1)]
    public async Task Daily_LimitsRevenueOrdersAndVoidsToTheSource(
        OrderSourceEnum? source, double revenue, int orders, int voided)
    {
        await Seed();

        var rows = await Daily().Handle(
            new GetDailySalesReportQuery { FromDate = Day, ToDate = Day, Source = source }, default);

        var row = rows.ShouldHaveSingleItem();
        ((double)row.TotalRevenue).ShouldBe(revenue);
        row.OrderCount.ShouldBe(orders);
        row.VoidCancelledCount.ShouldBe(voided);
    }

    [Fact]
    public async Task Daily_NoSourceCountsEverything_SameAsBothSourcesAdded()
    {
        await Seed();
        var all = await Daily().Handle(new GetDailySalesReportQuery { FromDate = Day, ToDate = Day }, default);
        var shop = await Daily().Handle(
            new GetDailySalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.Pos }, default);
        var link = await Daily().Handle(
            new GetDailySalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.CustomerLink }, default);

        all.Single().TotalRevenue.ShouldBe(shop.Single().TotalRevenue + link.Single().TotalRevenue);
        all.Single().OrderCount.ShouldBe(shop.Single().OrderCount + link.Single().OrderCount);
        all.Single().TipsTotal.ShouldBe(shop.Single().TipsTotal + link.Single().TipsTotal);
    }

    [Fact]
    public async Task Daily_ASourceWithNoOrders_IsEmpty()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Sale(db, Product(db, "Burger", 100m), Noon, 100m);
            await db.SaveChangesAsync();
        }

        var rows = await Daily().Handle(
            new GetDailySalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.CustomerLink }, default);

        rows.ShouldBeEmpty();
    }

    // --- hourly ---

    [Fact]
    public async Task Hourly_LimitsToTheSource()
    {
        await Seed();

        var link = await Hourly().Handle(
            new GetHourlySalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.CustomerLink }, default);
        var shop = await Hourly().Handle(
            new GetHourlySalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.Pos }, default);

        link.Sum(r => r.OrderCount).ShouldBe(3);
        link.Sum(r => r.Revenue).ShouldBe(470m);
        shop.Sum(r => r.OrderCount).ShouldBe(3);
        shop.Sum(r => r.Revenue).ShouldBe(360m);
    }

    // --- payments ---

    [Fact]
    public async Task Payments_LimitsToTheSource()
    {
        await Seed();

        var link = await Payments().Handle(
            new GetPaymentsReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.CustomerLink }, default);

        link.Sum(r => r.OrderCount).ShouldBe(3);
        link.Sum(r => r.TotalAmount).ShouldBe(470m);
        link.Select(r => r.PaymentMethod).ShouldBe(["Cash", "Card"], ignoreOrder: true);
    }

    // --- staff ---

    [Fact]
    public async Task Staff_LimitsToTheSource()
    {
        await Seed();

        var link = await Staff().Handle(
            new GetStaffPerformanceReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.CustomerLink }, default);

        link.Sum(r => r.OrderCount).ShouldBe(3);
        link.Sum(r => r.TotalRevenue).ShouldBe(470m);
        link.Sum(r => r.TipsReceived).ShouldBe(20m);
    }

    // --- products ---

    [Fact]
    public async Task Products_LimitsItemsAndBundlesToTheSource()
    {
        await Seed();

        var link = await Products().Handle(
            new GetProductSalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.CustomerLink }, default);
        var shop = await Products().Handle(
            new GetProductSalesReportQuery { FromDate = Day, ToDate = Day, Source = OrderSourceEnum.Pos }, default);

        link.Select(r => r.ProductName).ShouldContain("Cola");
        link.Select(r => r.ProductName).ShouldNotContain("Burger");
        link.Single(r => r.ProductName == "Combo").QuantitySold.ShouldBe(2);

        shop.Select(r => r.ProductName).ShouldContain("Burger");
        shop.Select(r => r.ProductName).ShouldNotContain("Cola");
        shop.Single(r => r.ProductName == "Combo").QuantitySold.ShouldBe(1);
    }
}
