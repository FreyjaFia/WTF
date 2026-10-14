using WTF.Api.Features.Reports;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetPromotionPerformanceReportHandlerTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetPromotionPerformanceReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetPromotionPerformanceReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    [Fact]
    public async Task Handle_NoOrders_ReturnsEmptyList()
    {
        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_DiscountedLinesAndBundles_AreGroupedAndSortedByRevenue()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var combo = Promotion(db, "Burger Combo", 1);
            var any2 = Promotion(db, "Any Two", 2);

            var order = Order(db, Noon);
            var line = Item(db, order, p, 3, 80m);
            line.PromoLabel = "20% off";
            line.OriginalPrice = 100m;
            var order2 = Order(db, Noon);
            var line2 = Item(db, order2, p, 1, 80m);
            line2.PromoLabel = "20% off";
            line2.OriginalPrice = 100m;
            Bundle(db, order, combo, 2, 60m);
            Bundle(db, order2, any2, 1, 30m);
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.Count.ShouldBe(3);
        rows.Select(r => r.PromotionName).ShouldBe(["20% off", "Burger Combo", "Any Two"]);

        var discounted = rows[0];
        discounted.PromotionType.ShouldBe("Discounted Product");
        discounted.Uses.ShouldBe(4);
        discounted.Revenue.ShouldBe(320m);
        discounted.DiscountGiven.ShouldBe(80m);

        rows[1].PromotionType.ShouldBe("Fixed Bundle");
        rows[1].Uses.ShouldBe(2);
        rows[1].Revenue.ShouldBe(120m);
        rows[1].DiscountGiven.ShouldBeNull();
        rows[2].PromotionType.ShouldBe("Mix & Match");
    }

    [Fact]
    public async Task Handle_NonCompletedOrdersAndOtherDays_AreExcluded()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var combo = Promotion(db, "Burger Combo", 1);
            foreach (var (status, at) in new[] { (Cancelled, Noon), (Refunded, Noon), (Pending, Noon), (Completed, Utc(2026, 3, 12, 4)) })
            {
                var order = Order(db, at, status);
                var line = Item(db, order, p, 1, 80m);
                line.PromoLabel = "20% off";
                line.OriginalPrice = 100m;
                Bundle(db, order, combo, 1, 60m);
            }

            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_PriceAboveListPrice_GivesNoNegativeDiscount()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Burger", 100m);
            var order = Order(db, Noon);
            var line = Item(db, order, p, 2, 120m);
            line.PromoLabel = "Odd";
            line.OriginalPrice = 100m;
            await db.SaveChangesAsync();
        }

        var rows = await Handler().Handle(Query(), default);

        rows.ShouldHaveSingleItem().DiscountGiven.ShouldBe(0m);
    }
}
