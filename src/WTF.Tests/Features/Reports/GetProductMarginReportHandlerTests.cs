using WTF.Api.Features.Inventory;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetProductMarginReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private GetProductMarginReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetProductMarginReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    private static void Move(WTFDbContext db, Order order, Product product, string type, decimal delta, decimal? unitCost) =>
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

    private async Task<List<ProductMarginReportRowDto>> Run() => await Handler().Handle(Query(), default);

    [Fact]
    public async Task NoOrders_ReturnsNothing()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            await db.SaveChangesAsync();
        }

        (await Run()).ShouldBeEmpty();
    }

    [Fact]
    public async Task AProductWithStockMovements_ShowsItsCostProfitAndMargin()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Sale(db, latte, Noon, 150m);
            order.OrderItems.Clear();
            Item(db, order, latte, 2, 150m);
            Move(db, order, latte, "Sale", -420m, 0.10m);
            Move(db, order, latte, "Sale", -2m, 4m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.QuantitySold.ShouldBe(2);
        row.Revenue.ShouldBe(300m);
        row.Cost.ShouldBe(50m);
        row.GrossProfit.ShouldBe(250m);
        row.MarginPercent.ShouldBe(83.33m);
        row.CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task TheSuppliesCost_IsAddedPerUnitSold()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            latte.SuppliesCost = 2.5m;
            var order = Order(db, Noon);
            Item(db, order, latte, 2, 150m);
            Move(db, order, latte, "Sale", -420m, 0.10m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.Cost.ShouldBe(47m);
        row.GrossProfit.ShouldBe(253m);
    }

    [Fact]
    public async Task AProductWithNoStockMovementsAndNoSupplies_HasNoCostAndNoProfit()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var water = Product(db, "Water", 20m, DrinksCategory);
            Sale(db, water, Noon, 20m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.Revenue.ShouldBe(20m);
        row.Cost.ShouldBeNull();
        row.GrossProfit.ShouldBeNull();
        row.MarginPercent.ShouldBeNull();
        row.CostStatus.ShouldBe("No cost");
    }

    [Fact]
    public async Task AProductWithOnlySuppliesAndNoRecipe_HasItsSuppliesAsTheCost()
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
        row.GrossProfit.ShouldBe(57m);
        row.CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task ARefundedSaleThatWasRestocked_CountsNoRevenueAndNoCost()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon, Refunded);
            Item(db, order, latte, 1, 150m);
            Move(db, order, latte, "Sale", -200m, 0.10m);
            Move(db, order, latte, "SaleVoid", 200m, 0.10m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.QuantitySold.ShouldBe(0);
        row.Revenue.ShouldBe(0m);
        row.Cost.ShouldBe(0m);
        row.MarginPercent.ShouldBeNull();
    }

    [Fact]
    public async Task OrdersBeforeStockTracking_MakeTheRowPartlyKnownAndLeaveProfitOut()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var tracked = Order(db, Noon);
            Item(db, tracked, latte, 1, 150m);
            Move(db, tracked, latte, "Sale", -200m, 0.10m);
            var untracked = Order(db, Noon);
            Item(db, untracked, latte, 1, 150m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.QuantitySold.ShouldBe(2);
        row.Revenue.ShouldBe(300m);
        row.Cost.ShouldBe(20m);
        row.GrossProfit.ShouldBeNull();
        row.CostStatus.ShouldBe("Partly known");
    }

    [Fact]
    public async Task AMovementWithNoCost_MakesTheCostUnknown()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, latte, 1, 150m);
            Move(db, order, latte, "Sale", -200m, null);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.CostStatus.ShouldBe("No cost");
        row.GrossProfit.ShouldBeNull();
    }

    [Fact]
    public async Task AnAddOn_HasItsOwnRowWithItsOwnCost()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var oat = Product(db, "Oat", 30m, DrinksCategory);
            oat.IsAddOn = true;
            var order = Order(db, Noon);
            var line = Item(db, order, latte, 1, 150m);
            Item(db, order, oat, 1, 30m, line);
            Move(db, order, latte, "Sale", -100m, 0.10m);
            Move(db, order, oat, "Sale", -200m, 0.20m);
            await db.SaveChangesAsync();
        }

        var rows = await Run();

        var oatRow = rows.Single(r => r.ProductName == "Oat");
        oatRow.IsAddOn.ShouldBeTrue();
        oatRow.Revenue.ShouldBe(30m);
        oatRow.Cost.ShouldBe(40m);
        oatRow.GrossProfit.ShouldBe(-10m);
        var latteRow = rows.Single(r => r.ProductName == "Latte");
        latteRow.Cost.ShouldBe(10m);
        latteRow.GrossProfit.ShouldBe(140m);
    }

    [Fact]
    public async Task ABundle_CarriesTheCostOfTheProductsSoldInsideIt()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var promo = Promotion(db, "Latte Deal", 1);
            var order = Order(db, Noon);
            var line = Item(db, order, latte, 2);
            line.BundlePromotionId = promo.Id;
            Bundle(db, order, promo, 1, 200m);
            Move(db, order, latte, "Sale", -400m, 0.10m);
            await db.SaveChangesAsync();
        }

        var rows = await Run();

        var bundle = rows.Single(r => r.ProductName == "Latte Deal");
        bundle.Revenue.ShouldBe(200m);
        bundle.Cost.ShouldBe(40m);
        bundle.GrossProfit.ShouldBe(160m);
        rows.Count.ShouldBe(1);
    }

    [Fact]
    public async Task AProductSoldAloneAndInsideABundleInOneOrder_SplitsItsCostByUnits()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var promo = Promotion(db, "Latte Deal", 1);
            var order = Order(db, Noon);
            Item(db, order, latte, 1, 150m);
            var bundled = Item(db, order, latte, 2);
            bundled.BundlePromotionId = promo.Id;
            Bundle(db, order, promo, 1, 200m);
            Move(db, order, latte, "Sale", -300m, 0.10m);
            await db.SaveChangesAsync();
        }

        var rows = await Run();

        rows.Single(r => r.ProductName == "Latte").Cost.ShouldBe(10m);
        rows.Single(r => r.ProductName == "Latte Deal").Cost.ShouldBe(20m);
    }

    [Fact]
    public async Task OrdersOutsideTheDates_AreLeftOut()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var old = Order(db, Utc(2026, 2, 1, 4));
            Item(db, old, latte, 1, 150m);
            Move(db, old, latte, "Sale", -200m, 0.10m);
            await db.SaveChangesAsync();
        }

        (await Run()).ShouldBeEmpty();
    }

    [Fact]
    public async Task TheRowsAreSortedByProfitWithUnknownProfitLast()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var small = Product(db, "Small", 100m, DrinksCategory);
            var big = Product(db, "Big", 200m, DrinksCategory);
            var unknown = Product(db, "Unknown", 500m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, small, 1, 100m);
            Item(db, order, big, 1, 200m);
            Item(db, order, unknown, 1, 500m);
            Move(db, order, small, "Sale", -1m, 10m);
            Move(db, order, big, "Sale", -1m, 20m);
            await db.SaveChangesAsync();
        }

        (await Run()).Select(r => r.ProductName).ToList().ShouldBe(["Big", "Small", "Unknown"]);
    }
}
