using WTF.Api.Features.Reports;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class ReportRefundAndAddOnTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetDailySalesReportHandler Daily() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private GetProductSalesReportHandler Products() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    [Fact]
    public async Task Daily_RefundedOrders_AreReportedSeparatelyFromNetSales()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Noon, 200m);
            Sale(db, p, Noon, 50m, Refunded);
            Sale(db, p, Noon, 25m, Refunded);
            Sale(db, p, Noon, 900m, Cancelled);
            await db.SaveChangesAsync();
        }

        var rows = await Daily().Handle(
            new GetDailySalesReportQuery { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) }, default);

        var row = rows.ShouldHaveSingleItem();
        row.RefundedCount.ShouldBe(2);
        row.RefundedAmount.ShouldBe(75m);
        row.NetSales.ShouldBe(200m);
        row.GrossSales.ShouldBe(275m);
        row.TotalRevenue.ShouldBe(200m);
        row.VoidCancelledCount.ShouldBe(3);
    }

    [Fact]
    public async Task Daily_NoRefunds_HasZeroRefundFields()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Sale(db, Product(db, "Burger", 100m), Noon, 100m);
            await db.SaveChangesAsync();
        }

        var rows = await Daily().Handle(
            new GetDailySalesReportQuery { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) }, default);

        var row = rows.ShouldHaveSingleItem();
        row.RefundedCount.ShouldBe(0);
        row.RefundedAmount.ShouldBe(0m);
        row.GrossSales.ShouldBe(100m);
        row.NetSales.ShouldBe(100m);
    }

    private async Task SeedLatteWithAddOns()
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var latte = Product(db, "Latte", 100m, DrinksCategory);
        var shot = Product(db, "Extra Shot", 10m, DrinksCategory);
        var order = Order(db, Noon);
        var parent = Item(db, order, latte, 2, 100m);
        Item(db, order, shot, 3, null, parent);
        await db.SaveChangesAsync();
    }

    private static GetProductSalesReportQuery Query(bool? split) =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10), SplitAddOns = split };

    [Fact]
    public async Task Products_AddOnsNotSplit_AreFoldedIntoTheParentRevenue()
    {
        await SeedLatteWithAddOns();

        var rows = await Products().Handle(Query(null), default);

        var row = rows.ShouldHaveSingleItem();
        row.ProductName.ShouldBe("Latte");
        row.Revenue.ShouldBe(260m); // (100 + 3 x 10) x 2
        row.IsAddOn.ShouldBeFalse();
    }

    [Fact]
    public async Task Products_SplitAddOns_GivesAddOnsTheirOwnRowsAndKeepsTheTotal()
    {
        await SeedLatteWithAddOns();

        var rows = await Products().Handle(Query(true), default);

        rows.Count.ShouldBe(2);
        var latte = rows.Single(r => r.ProductName == "Latte");
        latte.Revenue.ShouldBe(200m);
        latte.IsAddOn.ShouldBeFalse();
        var shot = rows.Single(r => r.ProductName == "Extra Shot");
        shot.IsAddOn.ShouldBeTrue();
        shot.CategoryName.ShouldBe("Add-ons");
        shot.QuantitySold.ShouldBe(6); // 3 per latte x 2 lattes
        shot.Revenue.ShouldBe(60m);
        rows.Sum(r => r.Revenue).ShouldBe(260m);
        rows.Sum(r => r.RevenuePercent).ShouldBe(100m, 0.0001m);
    }

    [Fact]
    public async Task Products_SplitAddOnsFalse_BehavesLikeNull()
    {
        await SeedLatteWithAddOns();

        var rows = await Products().Handle(Query(false), default);

        rows.ShouldHaveSingleItem().Revenue.ShouldBe(260m);
    }
}
