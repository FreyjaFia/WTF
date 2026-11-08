using WTF.Api.Features.Inventory;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetProfitLossReportHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private async Task<List<ProfitLossReportRowDto>> Run(
        ReportGroupByEnum? groupBy = null,
        DateTime? from = null,
        DateTime? to = null) =>
        await new GetProfitLossReportHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila")).Handle(
            new GetProfitLossReportQuery { FromDate = from ?? new DateTime(2026, 3, 1), ToDate = to ?? new DateTime(2026, 3, 31), GroupBy = groupBy },
            default);

    private static void SaleMove(WTFDbContext db, Order order, Product product, decimal delta, decimal unitCost) =>
        db.StockMovements.Add(new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = Guid.NewGuid(),
            MovementType = "Sale",
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

    private static void Expense(WTFDbContext db, DateOnly date, decimal amount, bool active = true, byte category = 1) =>
        db.Expenses.Add(new Expense
        {
            Id = Guid.NewGuid(),
            ExpenseDate = date,
            Category = category,
            Amount = amount,
            IsActive = active,
            CreatedAt = Noon,
            CreatedBy = StaffA
        });

    // Two lattes at 150 on 10 March, costing 50 (so a gross profit of 250).
    private async Task SeedLatteSaleAsync(bool withCost = true)
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var latte = Product(db, "Latte", 150m, DrinksCategory);
        var order = Order(db, Noon);
        Item(db, order, latte, 2, 150m);
        if (withCost)
        {
            SaleMove(db, order, latte, -500m, 0.10m);
        }

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task NothingAtAll_ReturnsNothing()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            await db.SaveChangesAsync();
        }

        (await Run()).ShouldBeEmpty();
    }

    [Fact]
    public async Task ExpensesInThePeriod_AreTakenOffTheGrossProfit()
    {
        await SeedLatteSaleAsync();
        await using (var db = TestDb.Create(_dbName))
        {
            Expense(db, new DateOnly(2026, 3, 10), 100m);
            Expense(db, new DateOnly(2026, 3, 10), 50m, category: 3);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.NetSales.ShouldBe(300m);
        row.Cost.ShouldBe(50m);
        row.ActualProfit.ShouldBe(250m);
        row.Expenses.ShouldBe(150m);
        row.OperatingProfit.ShouldBe(100m);
        row.MarginPercent.ShouldBe(33.33m);
        row.CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task ADayWithExpensesAndNoSales_GetsItsOwnRowAsALoss()
    {
        await SeedLatteSaleAsync();
        await using (var db = TestDb.Create(_dbName))
        {
            Expense(db, new DateOnly(2026, 3, 1), 12000m);
            await db.SaveChangesAsync();
        }

        var rows = await Run();

        rows.Count.ShouldBe(2);
        var rent = rows.First();
        rent.PeriodStart.ShouldBe(new DateTime(2026, 3, 1));
        rent.NetSales.ShouldBe(0m);
        rent.ActualProfit.ShouldBe(0m);
        rent.OperatingProfit.ShouldBe(-12000m);
        rent.MarginPercent.ShouldBeNull();
        rent.CostStatus.ShouldBe("Known");
    }

    [Fact]
    public async Task ByMonth_AllTheMonthsExpensesAddUpInOneRow()
    {
        await SeedLatteSaleAsync();
        await using (var db = TestDb.Create(_dbName))
        {
            Expense(db, new DateOnly(2026, 3, 1), 10000m);
            Expense(db, new DateOnly(2026, 3, 15), 800m);
            Expense(db, new DateOnly(2026, 3, 31), 200m);
            await db.SaveChangesAsync();
        }

        var row = (await Run(ReportGroupByEnum.Month)).Single();

        row.PeriodStart.ShouldBe(new DateTime(2026, 3, 1));
        row.Expenses.ShouldBe(11000m);
        row.OperatingProfit.ShouldBe(250m - 11000m);
    }

    [Fact]
    public async Task ByWeek_ExpensesGoToTheMondayBasedWeekTheirDateIsIn()
    {
        await SeedLatteSaleAsync();
        await using (var db = TestDb.Create(_dbName))
        {
            Expense(db, new DateOnly(2026, 3, 8), 10m);
            Expense(db, new DateOnly(2026, 3, 9), 20m);
            Expense(db, new DateOnly(2026, 3, 15), 30m);
            await db.SaveChangesAsync();
        }

        var rows = await Run(ReportGroupByEnum.Week);

        rows.Select(r => (r.PeriodStart, r.Expenses)).ShouldBe(
        [
            (new DateTime(2026, 3, 2), 10m),
            (new DateTime(2026, 3, 9), 50m)
        ]);
    }

    [Fact]
    public async Task DeletedExpensesAndExpensesOutsideTheRange_AreLeftOut()
    {
        await SeedLatteSaleAsync();
        await using (var db = TestDb.Create(_dbName))
        {
            Expense(db, new DateOnly(2026, 3, 10), 70m);
            Expense(db, new DateOnly(2026, 3, 10), 5000m, active: false);
            Expense(db, new DateOnly(2026, 2, 28), 5000m);
            Expense(db, new DateOnly(2026, 4, 1), 5000m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.Expenses.ShouldBe(70m);
        row.OperatingProfit.ShouldBe(180m);
    }

    [Fact]
    public async Task AnExpenseOnTheFirstAndTheLastDayOfTheRange_IsCounted()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Expense(db, new DateOnly(2026, 3, 10), 1m);
            Expense(db, new DateOnly(2026, 3, 12), 2m);
            await db.SaveChangesAsync();
        }

        var rows = await Run(from: new DateTime(2026, 3, 10), to: new DateTime(2026, 3, 12));

        rows.Sum(r => r.Expenses).ShouldBe(3m);
    }

    [Fact]
    public async Task ASaleWithNoKnownCost_ShowsTheExpensesButNoOperatingProfit()
    {
        await SeedLatteSaleAsync(withCost: false);
        await using (var db = TestDb.Create(_dbName))
        {
            Expense(db, new DateOnly(2026, 3, 10), 100m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.CostStatus.ShouldBe("No cost");
        row.ActualProfit.ShouldBeNull();
        row.Expenses.ShouldBe(100m);
        row.OperatingProfit.ShouldBeNull();
        row.MarginPercent.ShouldBeNull();
    }

    [Fact]
    public async Task APartlyKnownDay_StillGivesAnOperatingProfitAndSaysSo()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var latte = Product(db, "Latte", 150m, DrinksCategory);
            var water = Product(db, "Water", 20m, DrinksCategory);
            var order = Order(db, Noon);
            Item(db, order, latte, 1, 150m);
            Item(db, order, water, 1, 20m);
            SaleMove(db, order, latte, -250m, 0.10m);
            Expense(db, new DateOnly(2026, 3, 10), 45m);
            await db.SaveChangesAsync();
        }

        var row = (await Run()).Single();

        row.CostStatus.ShouldBe("Partly known");
        row.ActualProfit.ShouldBe(145m);
        row.OperatingProfit.ShouldBe(100m);
    }
}
