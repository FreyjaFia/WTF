using WTF.Api.Features.Inventory;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetGrossProfitReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);
    private static readonly DateTime NextDayNoon = Utc(2026, 3, 11, 4);

    private GetGrossProfitReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private async Task<List<GrossProfitReportRowDto>> Run(ReportGroupByEnum? groupBy = null) =>
        await Handler().Handle(
            new GetGrossProfitReportQuery { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 11), GroupBy = groupBy },
            default);

    private static void SaleMove(WTFDbContext db, Order order, Product product, string type, decimal delta, decimal? unitCost) =>
        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = Guid.NewGuid(),
            MovementType = type,
            QuantityDelta = delta,
            QuantityBefore = 1000m,
            QuantityAfter = 1000m + delta,
            UnitCost = unitCost,
            ReferenceType = StockMovementTypes.OrderReference,
            ReferenceId = order.Id,
            ProductId = product.Id,
            CreatedAt = order.CreatedAt,
            CreatedBy = StaffA
        });

    private static void Loss(WTFDbContext db, string type, decimal delta, decimal? unitCost, DateTime at) =>
        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = Guid.NewGuid(),
            MovementType = type,
            QuantityDelta = delta,
            QuantityBefore = 1000m,
            QuantityAfter = 1000m + delta,
            UnitCost = unitCost,
            ReferenceType = type == StockMovementTypes.Waste || type == StockMovementTypes.WasteReversed
                ? StockMovementTypes.StockWasteReference
                : StockMovementTypes.StockCountReference,
            ReferenceId = Guid.NewGuid(),
            CreatedAt = at,
            CreatedBy = StaffA
        });

    [Fact]
    public async Task NoActivity_ReturnsNothing()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            await db.SaveChangesAsync();
        }

        (await Run()).ShouldBeEmpty();
    }

    [Fact]
    public async Task ASaleWithWasteAndACountCorrection_ShowsTheoreticalAndActualProfit()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, latte, 2, 150m);
            SaleMove(db, order, latte, "Sale", -420m, 0.10m);
            SaleMove(db, order, latte, "Sale", -2m, 4m);
            Loss(db, StockMovementTypes.Waste, -100m, 0.10m, Noon);
            Loss(db, StockMovementTypes.Count, -20m, 0.10m, Noon);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.NetSales.ShouldBe(300m);
        row.Cost.ShouldBe(50m);
        row.TheoreticalProfit.ShouldBe(250m);
        row.WasteCost.ShouldBe(10m);
        row.CountVariance.ShouldBe(2m);
        row.ActualProfit.ShouldBe(238m);
        row.MarginPercent.ShouldBe(79.33m);
        row.CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task AFoundSurplusOnACount_RaisesTheActualProfit()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, latte, 1, 150m);
            SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            Loss(db, StockMovementTypes.Adjustment, 50m, 0.10m, Noon);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.CountVariance.ShouldBe(-5m);
        row.ActualProfit.ShouldBe(135m);
    }

    [Fact]
    public async Task AReversedWasteEntry_GivesItsCostBack()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Loss(db, StockMovementTypes.Waste, -100m, 0.10m, Noon);
            Loss(db, StockMovementTypes.WasteReversed, 100m, 0.10m, Noon);
            await db.SaveChangesAsync();
        }

        (await Run()).Single().WasteCost.ShouldBe(0m);
    }

    [Fact]
    public async Task WasteOnADayWithNoSales_GetsItsOwnRowAndALoss()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, latte, 1, 150m);
            SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            Loss(db, StockMovementTypes.Waste, -300m, 0.10m, NextDayNoon);
            await db.SaveChangesAsync();
        }

        var rows = await Run();

        rows.Count.ShouldBe(2);
        rows[0].PeriodStart.ShouldBe(new DateTime(2026, 3, 10));
        rows[0].WasteCost.ShouldBe(0m);
        rows[1].PeriodStart.ShouldBe(new DateTime(2026, 3, 11));
        rows[1].NetSales.ShouldBe(0m);
        rows[1].WasteCost.ShouldBe(30m);
        rows[1].ActualProfit.ShouldBe(-30m);
        rows[1].MarginPercent.ShouldBeNull();
        rows[1].CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task AWasteEntryWithNoCost_MakesThePeriodPartlyKnown()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, latte, 1, 150m);
            SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            Loss(db, StockMovementTypes.Waste, -50m, null, Noon);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.CostStatus.ShouldBe("Partly known");
        row.WasteCost.ShouldBe(0m);
        row.ActualProfit.ShouldBe(130m);
    }

    [Fact]
    public async Task SalesOfAProductWithNoStockAndNoSupplies_HaveNoCostAndNoProfit()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var water = Product(db, "Water", 20m, DrinksCategory);
            Sale(db, water, Noon, 20m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.NetSales.ShouldBe(20m);
        row.Cost.ShouldBe(0m);
        row.TheoreticalProfit.ShouldBeNull();
        row.ActualProfit.ShouldBeNull();
        row.MarginPercent.ShouldBeNull();
        row.CostStatus.ShouldBe("No cost");
    }

    [Fact]
    public async Task SomeSalesWithACostAndSomeWithout_ArePartlyKnownButStillShowProfit()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var water = Product(db, "Water", 20m, DrinksCategory);
            var tracked = Order(db, Noon);
            Item(db, tracked, latte, 1, 150m);
            SaleMove(db, tracked, latte, "Sale", -200m, 0.10m);
            Sale(db, water, Noon, 20m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.CostStatus.ShouldBe("Partly known");
        row.NetSales.ShouldBe(170m);
        row.Cost.ShouldBe(20m);
        row.ActualProfit.ShouldBe(150m);
    }

    [Fact]
    public async Task TheSuppliesCost_IsAddedPerUnitSold()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var water = Product(db, "Water", 20m, DrinksCategory);
            water.SuppliesCost = 1m;
            var order = Order(db, Noon);
            Item(db, order, water, 3, 20m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.Cost.ShouldBe(3m);
        row.TheoreticalProfit.ShouldBe(57m);
        row.CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task ARefundedSaleThatWasRestocked_AddsNoRevenueAndNoCost()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon, Refunded);
            Item(db, order, latte, 1, 150m);
            SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            SaleMove(db, order, latte, "SaleVoid", 200m, 0.10m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.NetSales.ShouldBe(0m);
        row.Cost.ShouldBe(0m);
        row.ActualProfit.ShouldBe(0m);
    }

    [Fact]
    public async Task ARefundThatWasNotRestocked_ShowsItsCostAsWasteNotTwice()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon, Refunded);
            Item(db, order, latte, 1, 150m);
            SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            SaleMove(db, order, latte, "SaleVoid", 200m, 0.10m);
            Loss(db, StockMovementTypes.Waste, -200m, 0.10m, Noon);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.Cost.ShouldBe(0m);
        row.WasteCost.ShouldBe(20m);
        row.ActualProfit.ShouldBe(-20m);
    }

    [Fact]
    public async Task GroupingByMonth_AddsTheDaysTogether()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            foreach (var at in new[] { Noon, NextDayNoon })
            {
                var order = Order(db, at);
                Item(db, order, latte, 1, 150m);
                SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            }

            Loss(db, StockMovementTypes.Waste, -100m, 0.10m, NextDayNoon);
            await db.SaveChangesAsync();
        }

        var row = (await Run(ReportGroupByEnum.Month)).Single();

        row.PeriodStart.ShouldBe(new DateTime(2026, 3, 1));
        row.NetSales.ShouldBe(300m);
        row.Cost.ShouldBe(40m);
        row.WasteCost.ShouldBe(10m);
        row.ActualProfit.ShouldBe(250m);
    }

    [Fact]
    public async Task ASaleOutsideTheRange_IsLeftOut()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Utc(2026, 3, 20, 4));
            Item(db, order, latte, 1, 150m);
            SaleMove(db, order, latte, "Sale", -200m, 0.10m);
            Loss(db, StockMovementTypes.Waste, -100m, 0.10m, Utc(2026, 3, 20, 4));
            await db.SaveChangesAsync();
        }

        (await Run()).ShouldBeEmpty();
    }
}
