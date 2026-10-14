using WTF.Api.Features.Reports;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetPaymentsReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetPaymentsReportHandler Handler(string? timeZone = "Asia/Manila") =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: timeZone));

    private static GetPaymentsReportQuery Query(DateTime from, DateTime to) =>
        new() { FromDate = from, ToDate = to };

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_OrdersWithDifferentMethods_GroupsTotalsAndOrdersByAmountDescending()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = Utc(2026, 3, 10, 4);
            Sale(db, p, at, 100m, payment: Cash);
            Sale(db, p, at, 50m, payment: Cash);
            Sale(db, p, at, 350m, payment: Card);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.Count.ShouldBe(2);
        rows[0].PaymentMethod.ShouldBe("Card");
        rows[0].OrderCount.ShouldBe(1);
        rows[0].TotalAmount.ShouldBe(350m);
        rows[0].TotalPercent.ShouldBe(70m, 0.0001m);
        rows[1].PaymentMethod.ShouldBe("Cash");
        rows[1].OrderCount.ShouldBe(2);
        rows[1].TotalAmount.ShouldBe(150m);
        rows[1].TotalPercent.ShouldBe(30m, 0.0001m);
    }

    [Fact]
    public async Task Handle_OrderWithoutPaymentMethod_IsGroupedAsUnknown()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 4), 40m, payment: null);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        var row = rows.ShouldHaveSingleItem();
        row.PaymentMethod.ShouldBe("Unknown");
        row.TotalPercent.ShouldBe(100m, 0.0001m);
    }

    [Fact]
    public async Task Handle_RefundedOrdersShowAsRefundedAmount_PendingAndCancelledAreExcluded()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var at = Utc(2026, 3, 10, 4);
            Sale(db, p, at, 100m);
            Sale(db, p, at, 900m, Cancelled, payment: Card);
            Sale(db, p, at, 900m, Refunded, payment: Card);
            Sale(db, p, at, 900m, Pending, payment: Card);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        rows.Count.ShouldBe(2);
        var row = rows.Single(r => r.PaymentMethod == "Cash");
        row.TotalAmount.ShouldBe(100m);
        row.OrderCount.ShouldBe(1);
        var card = rows.Single(r => r.PaymentMethod == "Card");
        card.OrderCount.ShouldBe(0);
        card.TotalAmount.ShouldBe(0m);
        card.RefundedAmount.ShouldBe(900m);
        card.GrossSales.ShouldBe(900m);
    }

    [Fact]
    public async Task Handle_ZeroValueOrders_HaveZeroPercent()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 4), 0m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        var row = rows.ShouldHaveSingleItem();
        row.OrderCount.ShouldBe(1);
        row.TotalPercent.ShouldBe(0m);
    }

    [Fact]
    public async Task Handle_LocalDayEdges_UseRequestTimeZone()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            Sale(db, p, Utc(2026, 3, 10, 15, 59), 10m); // 3/10 in Manila
            Sale(db, p, Utc(2026, 3, 10, 16, 1), 20m);  // 3/11 in Manila
            await db.SaveChangesAsync();
        }

        var manila = await Handler("Asia/Manila").Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);
        var utc = await Handler("UTC").Handle(Query(new DateTime(2026, 3, 10), new DateTime(2026, 3, 10)), default);

        manila.ShouldHaveSingleItem().TotalAmount.ShouldBe(10m);
        utc.ShouldHaveSingleItem().TotalAmount.ShouldBe(30m);
    }
}
