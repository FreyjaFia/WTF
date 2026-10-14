using WTF.Api.Features.Reports;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetDailyCloseReportHandlerTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetDailyCloseReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetDailyCloseReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    [Fact]
    public async Task Handle_NoOrders_ReturnsZeroedSalesSectionOnly()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldAllBe(r => r.Section == GetDailyCloseReportHandler.SalesSection);
        rows.Single(r => r.Label == "Net sales").Amount.ShouldBe(0m);
        rows.Single(r => r.Label == "Gross sales").OrderCount.ShouldBe(0);
    }

    [Fact]
    public async Task Handle_MixedDay_ReportsSalesPaymentsStaffAndVoids()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Noon, 200m, by: StaffA, payment: Cash);
            Sale(db, p, Noon, 100m, by: StaffB, payment: Card, tips: 10m);
            var refunded = Sale(db, p, Noon, 50m, Refunded, StaffA);
            refunded.Note = "wrong item";
            Sale(db, p, Noon, 900m, Cancelled, StaffB);
            Sale(db, p, Noon, 700m, Pending);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        var sales = rows.Where(r => r.Section == "Sales").ToDictionary(r => r.Label);
        sales["Gross sales"].Amount.ShouldBe(350m);
        sales["Gross sales"].OrderCount.ShouldBe(3);
        sales["Refunds"].Amount.ShouldBe(50m);
        sales["Refunds"].OrderCount.ShouldBe(1);
        sales["Net sales"].Amount.ShouldBe(300m);
        sales["Net sales"].OrderCount.ShouldBe(2);
        sales["Average order"].Amount.ShouldBe(150m);
        sales["Tips"].Amount.ShouldBe(10m);
        sales["Cancelled orders"].OrderCount.ShouldBe(1);
        sales["Cancelled orders"].Amount.ShouldBe(0m);

        var payments = rows.Where(r => r.Section == "Payments").ToList();
        payments.Select(r => r.Label).ShouldBe(["Card", "Cash"]);
        payments[0].Amount.ShouldBe(100m);
        payments[0].Detail.ShouldBe("Tips PHP 10.00");
        payments[1].Amount.ShouldBe(200m);

        var staff = rows.Where(r => r.Section == "Staff").ToList();
        staff.Select(r => r.Label).ShouldBe(["Ana Cruz", "Ben Reyes"]);
        staff[0].Amount.ShouldBe(200m);
        staff[1].Amount.ShouldBe(100m);

        var voids = rows.Where(r => r.Section == "Voids").ToList();
        voids.Count.ShouldBe(2);
        var refund = voids.Single(r => r.Label.EndsWith("(Refunded)"));
        refund.Amount.ShouldBe(50m);
        refund.Detail.ShouldBe("wrong item");
        voids.Single(r => r.Label.EndsWith("(Cancelled)")).Amount.ShouldBe(900m);
    }

    [Fact]
    public async Task Handle_OrdersOutsideTheDay_AreLeftOut()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 500m); // 3/11 in Manila
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.Single(r => r.Label == "Net sales").Amount.ShouldBe(0m);
    }
}
