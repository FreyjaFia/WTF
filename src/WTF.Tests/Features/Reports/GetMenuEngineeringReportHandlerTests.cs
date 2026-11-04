using WTF.Api.Features.Inventory;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetMenuEngineeringReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private GetMenuEngineeringReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private async Task<List<MenuEngineeringReportRowDto>> Run() =>
        await Handler().Handle(new GetMenuEngineeringReportQuery { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) }, default);

    private static void Sell(WTFDbContext db, string name, decimal price, int quantity, decimal? costPerUnit)
    {
        var product = Product(db, name, price, DrinksCategory);
        var order = Order(db, Noon);
        Item(db, order, product, quantity, price);
        if (costPerUnit.HasValue)
        {
            db.StockMovements.Add(new StockMovement
            {
                Id = Guid.NewGuid(),
                ItemId = Guid.NewGuid(),
                MovementType = "Sale",
                QuantityDelta = -costPerUnit.Value * quantity,
                QuantityBefore = 1000m,
                QuantityAfter = 1000m - costPerUnit.Value * quantity,
                UnitCost = 1m,
                ReferenceType = StockMovementTypes.OrderReference,
                ReferenceId = order.Id,
                ProductId = product.Id,
                CreatedAt = order.CreatedAt,
                CreatedBy = StaffA
            });
        }
    }

    [Fact]
    public async Task SortsTheMenuIntoTheFourGroups_AndLeavesAProductWithoutACostUnrated()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Sell(db, "Latte", 100m, 6, 40m);
            Sell(db, "Mocha", 60m, 5, 40m);
            Sell(db, "Cake", 100m, 1, 20m);
            Sell(db, "Tea", 30m, 1, 20m);
            Sell(db, "Water", 20m, 9, null);
            await db.SaveChangesAsync();
        }

        var rows = (await Run()).ToDictionary(r => r.ProductName);

        rows["Latte"].MenuClass.ShouldBe("Star");
        rows["Latte"].UnitProfit.ShouldBe(60m);
        rows["Latte"].PopularityPercent.ShouldBe(46.15m);
        rows["Mocha"].MenuClass.ShouldBe("Plowhorse");
        rows["Cake"].MenuClass.ShouldBe("Puzzle");
        rows["Tea"].MenuClass.ShouldBe("Dog");
        rows["Water"].MenuClass.ShouldBe("Not rated");
        rows["Water"].UnitProfit.ShouldBeNull();
        rows["Water"].PopularityPercent.ShouldBeNull();
    }

    [Fact]
    public async Task AProductWithoutACostDoesNotChangeTheOthersRatings()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Sell(db, "Latte", 100m, 6, 40m);
            Sell(db, "Mocha", 60m, 5, 40m);
            Sell(db, "Water", 20m, 500, null);
            await db.SaveChangesAsync();
        }

        var rows = (await Run()).ToDictionary(r => r.ProductName);

        rows["Latte"].PopularityPercent.ShouldBe(54.55m);
    }

    [Fact]
    public async Task TheRowsComeStarsFirst_ThenByProfit_AndUnratedLast()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Sell(db, "Tea", 30m, 1, 20m);
            Sell(db, "Water", 20m, 2, null);
            Sell(db, "Latte", 100m, 6, 40m);
            Sell(db, "Mocha", 60m, 5, 40m);
            Sell(db, "Cake", 100m, 1, 20m);
            await db.SaveChangesAsync();
        }

        (await Run()).Select(r => r.ProductName).ShouldBe(["Latte", "Mocha", "Cake", "Tea", "Water"]);
    }

    [Fact]
    public async Task NoSales_ReturnsNothing()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            await db.SaveChangesAsync();
        }

        (await Run()).ShouldBeEmpty();
    }
}
