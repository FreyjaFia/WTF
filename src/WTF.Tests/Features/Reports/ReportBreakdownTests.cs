using NSubstitute;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Tests.Infrastructure;
using MediatR;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class ReportBreakdownTests
{
    private static readonly DateTime From = new(2026, 3, 10);

    private readonly string _dbName = TestDb.NewName();

    private T Make<T>(Func<Domain.Data.WTFDbContext, Microsoft.AspNetCore.Http.IHttpContextAccessor, T> create) =>
        create(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    // Day on 10 March (Manila):
    //  O1 completed, cash, Ana, 12:00: 2 burgers sold at 80 (list 100) with a 10 shot each = total 180, gross 220, discount 40
    //  O2 completed, card, Ben, 13:00: fries 40 + a bundle at 60 = total 100, gross 100, no discount
    //  O3 refunded, cash, Ana, 12:30: a burger at 90 (list 100) = value 90, gross 100, discount 10
    //  O4 cancelled and O5 pending: never counted
    private async Task SeedDay()
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var burger = Product(db, "Burger", 100m, FoodCategory);
        var fries = Product(db, "Fries", 40m, FoodCategory);
        var shot = Product(db, "Shot", 10m, DrinksCategory);
        var combo = Promotion(db, "Combo", 1);

        var o1 = Order(db, Utc(2026, 3, 10, 4), Completed, StaffA, Cash);
        var burgers = Item(db, o1, burger, 2, 80m);
        burgers.OriginalPrice = 100m;
        burgers.PromoLabel = "20% off";
        Item(db, o1, shot, 1, 10m, burgers);

        var o2 = Order(db, Utc(2026, 3, 10, 5), Completed, StaffB, Card);
        Item(db, o2, fries, 1, 40m);
        Bundle(db, o2, combo, 1, 60m);

        var o3 = Order(db, Utc(2026, 3, 10, 4, 30), Refunded, StaffA, Cash);
        var refundedBurger = Item(db, o3, burger, 1, 90m);
        refundedBurger.OriginalPrice = 100m;

        Sale(db, burger, Utc(2026, 3, 10, 4), 500m, Cancelled);
        Sale(db, burger, Utc(2026, 3, 10, 4), 500m, Pending);
        await db.SaveChangesAsync();
    }

    private static void IdentityHolds(decimal gross, decimal discount, decimal refunded, decimal net, string row) =>
        (gross - discount - refunded).ShouldBe(net, $"gross - discount - refunded should equal net on {row}");

    [Fact]
    public async Task Daily_StepColumns_AddUp()
    {
        await SeedDay();

        var rows = await Make((db, http) => new GetDailySalesReportHandler(db, http))
            .Handle(new GetDailySalesReportQuery { FromDate = From, ToDate = From }, default);

        var row = rows.ShouldHaveSingleItem();
        row.GrossSales.ShouldBe(420m);
        row.Discounts.ShouldBe(50m);
        row.RefundedAmount.ShouldBe(90m);
        row.NetSales.ShouldBe(280m);
        row.TotalRevenue.ShouldBe(280m);
        IdentityHolds(row.GrossSales, row.Discounts, row.RefundedAmount, row.NetSales, "daily");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Products_StepColumns_AddUpOnEveryRow_AndAcrossRows(bool splitAddOns)
    {
        await SeedDay();

        var rows = await Make((db, http) => new GetProductSalesReportHandler(db, http))
            .Handle(new GetProductSalesReportQuery { FromDate = From, ToDate = From, SplitAddOns = splitAddOns }, default);

        foreach (var row in rows)
        {
            IdentityHolds(row.GrossSales, row.Discounts, row.RefundedAmount, row.Revenue, row.ProductName);
        }

        rows.Sum(r => r.Revenue).ShouldBe(280m);
        rows.Sum(r => r.GrossSales).ShouldBe(420m);
        rows.Sum(r => r.Discounts).ShouldBe(50m);
        rows.Sum(r => r.RefundedAmount).ShouldBe(90m);

        var burger = rows.Single(r => r.ProductName == "Burger");
        burger.QuantitySold.ShouldBe(2);
        burger.Discounts.ShouldBe(50m);
        burger.RefundedAmount.ShouldBe(90m);
        burger.Revenue.ShouldBe(splitAddOns ? 160m : 180m);
        burger.GrossSales.ShouldBe(splitAddOns ? 300m : 320m);

        var bundle = rows.Single(r => r.ProductName == "Combo");
        bundle.GrossSales.ShouldBe(60m);
        bundle.Discounts.ShouldBe(0m);
        bundle.Revenue.ShouldBe(60m);

        rows.Any(r => r.ProductName == "Shot").ShouldBe(splitAddOns);
    }

    [Fact]
    public async Task Categories_StepColumns_AddUpOnEveryRow_AndAcrossRows()
    {
        await SeedDay();
        var products = Make((db, http) => new GetProductSalesReportHandler(db, http));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<GetProductSalesReportQuery>(), Arg.Any<CancellationToken>())
            .Returns(call => products.Handle(call.Arg<GetProductSalesReportQuery>(), default));

        var rows = await new GetCategorySalesReportHandler(sender)
            .Handle(new GetCategorySalesReportQuery { FromDate = From, ToDate = From }, default);

        foreach (var row in rows)
        {
            IdentityHolds(row.GrossSales, row.Discounts, row.RefundedAmount, row.Revenue, row.CategoryName);
        }

        rows.Select(r => r.CategoryName).ShouldBe(["Food", "Promotions"]);
        var food = rows[0];
        food.QuantitySold.ShouldBe(3);
        food.GrossSales.ShouldBe(360m);
        food.Discounts.ShouldBe(50m);
        food.RefundedAmount.ShouldBe(90m);
        food.Revenue.ShouldBe(220m);
        rows.Sum(r => r.Revenue).ShouldBe(280m);
        rows.Sum(r => r.RevenuePercent).ShouldBe(100m, 0.0001m);
    }

    [Fact]
    public async Task Payments_StepColumns_AddUpOnEveryRow()
    {
        await SeedDay();

        var rows = await Make((db, http) => new GetPaymentsReportHandler(db, http))
            .Handle(new GetPaymentsReportQuery { FromDate = From, ToDate = From }, default);

        foreach (var row in rows)
        {
            IdentityHolds(row.GrossSales, row.Discounts, row.RefundedAmount, row.TotalAmount, row.PaymentMethod);
        }

        var cash = rows.Single(r => r.PaymentMethod == "Cash");
        cash.OrderCount.ShouldBe(1);
        cash.GrossSales.ShouldBe(320m);
        cash.Discounts.ShouldBe(50m);
        cash.RefundedAmount.ShouldBe(90m);
        cash.TotalAmount.ShouldBe(180m);
        var card = rows.Single(r => r.PaymentMethod == "Card");
        card.GrossSales.ShouldBe(100m);
        card.TotalAmount.ShouldBe(100m);
        rows.Sum(r => r.TotalAmount).ShouldBe(280m);
    }

    [Fact]
    public async Task Hourly_StepColumns_AddUpOnEveryHour()
    {
        await SeedDay();

        var rows = await Make((db, http) => new GetHourlySalesReportHandler(db, http))
            .Handle(new GetHourlySalesReportQuery { FromDate = From, ToDate = From }, default);

        foreach (var row in rows)
        {
            IdentityHolds(row.GrossSales, row.Discounts, row.RefundedAmount, row.Revenue, $"hour {row.Hour}");
        }

        var noon = rows.Single(r => r.Hour == 12);
        noon.OrderCount.ShouldBe(1);
        noon.GrossSales.ShouldBe(320m);
        noon.Discounts.ShouldBe(50m);
        noon.RefundedAmount.ShouldBe(90m);
        noon.Revenue.ShouldBe(180m);
        rows.Single(r => r.Hour == 13).Revenue.ShouldBe(100m);
        rows.Sum(r => r.Revenue).ShouldBe(280m);
        rows.Sum(r => r.GrossSales).ShouldBe(420m);
    }

    [Fact]
    public async Task Staff_StepColumns_AddUpOnEveryRow()
    {
        await SeedDay();

        var rows = await Make((db, http) => new GetStaffPerformanceReportHandler(db, http))
            .Handle(new GetStaffPerformanceReportQuery { FromDate = From, ToDate = From }, default);

        foreach (var row in rows)
        {
            IdentityHolds(row.GrossSales, row.Discounts, row.RefundedAmount, row.TotalRevenue, row.StaffName);
        }

        var ana = rows.Single(r => r.StaffName == "Ana Cruz");
        ana.GrossSales.ShouldBe(320m);
        ana.Discounts.ShouldBe(50m);
        ana.RefundedAmount.ShouldBe(90m);
        ana.TotalRevenue.ShouldBe(180m);
        rows.Sum(r => r.TotalRevenue).ShouldBe(280m);
    }

    [Fact]
    public async Task AllReports_AgreeOnTheDaysFigures()
    {
        await SeedDay();

        var daily = (await Make((db, http) => new GetDailySalesReportHandler(db, http))
            .Handle(new GetDailySalesReportQuery { FromDate = From, ToDate = From }, default)).Single();
        var payments = await Make((db, http) => new GetPaymentsReportHandler(db, http))
            .Handle(new GetPaymentsReportQuery { FromDate = From, ToDate = From }, default);
        var staff = await Make((db, http) => new GetStaffPerformanceReportHandler(db, http))
            .Handle(new GetStaffPerformanceReportQuery { FromDate = From, ToDate = From }, default);
        var hourly = await Make((db, http) => new GetHourlySalesReportHandler(db, http))
            .Handle(new GetHourlySalesReportQuery { FromDate = From, ToDate = From }, default);

        foreach (var (gross, discounts, refunded, net) in new[]
        {
            (payments.Sum(r => r.GrossSales), payments.Sum(r => r.Discounts), payments.Sum(r => r.RefundedAmount), payments.Sum(r => r.TotalAmount)),
            (staff.Sum(r => r.GrossSales), staff.Sum(r => r.Discounts), staff.Sum(r => r.RefundedAmount), staff.Sum(r => r.TotalRevenue)),
            (hourly.Sum(r => r.GrossSales), hourly.Sum(r => r.Discounts), hourly.Sum(r => r.RefundedAmount), hourly.Sum(r => r.Revenue)),
        })
        {
            gross.ShouldBe(daily.GrossSales);
            discounts.ShouldBe(daily.Discounts);
            refunded.ShouldBe(daily.RefundedAmount);
            net.ShouldBe(daily.NetSales);
        }
    }
}
