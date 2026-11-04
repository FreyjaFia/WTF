using WTF.Api.Common.Auth;
using WTF.Api.Features.Expenses;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class ExpenseDatabaseTests
{
    [SqlFact]
    public async Task CreateUpdateDeleteRestore_RoundTripOnRealSqlServer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using var db = database.CreateContext();
        var request = TestRequest.As(user.Id, AppRoles.Admin, "UTC");
        var audit = TestFakes.Audit();
        var created = await new CreateExpenseHandler(db, request, audit, TimeProvider.System)
            .Handle(new CreateExpenseCommand(new DateOnly(2026, 3, 10), 1, 12000.5m, "March rent"), CancellationToken.None);

        await new UpdateExpenseHandler(db, request, audit, TimeProvider.System)
            .Handle(new UpdateExpenseCommand(created.Id, new DateOnly(2026, 3, 11), 3, 900m, "Power"), CancellationToken.None);
        await new DeleteExpenseHandler(db, request, audit, TimeProvider.System).Handle(new DeleteExpenseCommand(created.Id), CancellationToken.None);

        var hidden = await new GetExpensesHandler(db).Handle(new GetExpensesQuery(null, null, null, null), CancellationToken.None);
        hidden.Items.ShouldBeEmpty();

        await new RestoreExpenseHandler(db, request, audit, TimeProvider.System).Handle(new RestoreExpenseCommand(created.Id), CancellationToken.None);
        var shown = await new GetExpensesHandler(db).Handle(new GetExpensesQuery(new DateTime(2026, 3, 1), new DateTime(2026, 3, 31), null, null), CancellationToken.None);

        var row = shown.Items.Single();
        row.ExpenseDate.ShouldBe(new DateOnly(2026, 3, 11));
        row.Amount.ShouldBe(900m);
        row.CategoryName.ShouldBe("Utilities");
        shown.Total.ShouldBe(900m);
    }

    [SqlFact]
    public async Task TheProfitAndLossReport_TakesExpensesOffTheGrossProfitOnRealSqlServer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            db.Expenses.Add(NewExpense(user.Id, new DateOnly(2026, 3, 1), 1, 10000m));
            db.Expenses.Add(NewExpense(user.Id, new DateOnly(2026, 3, 31), 3, 800m));
            db.Expenses.Add(NewExpense(user.Id, new DateOnly(2026, 4, 1), 1, 10000m));
            db.Expenses.Add(NewExpense(user.Id, new DateOnly(2026, 3, 5), 1, 999m, isActive: false));
            await db.SaveChangesAsync();
        }

        await using var query = database.CreateContext();
        var rows = await new GetProfitLossReportHandler(query, TestRequest.As(user.Id, AppRoles.Admin, "UTC")).Handle(
            new GetProfitLossReportQuery { FromDate = new DateTime(2026, 3, 1), ToDate = new DateTime(2026, 3, 31), GroupBy = ReportGroupByEnum.Month },
            CancellationToken.None);

        var march = rows.Single();
        march.Expenses.ShouldBe(10800m);
        march.OperatingProfit.ShouldBe(-10800m);
    }

    private static Expense NewExpense(Guid userId, DateOnly date, byte category, decimal amount, bool isActive = true) => new()
    {
        Id = Guid.NewGuid(),
        ExpenseDate = date,
        Category = category,
        Amount = amount,
        IsActive = isActive,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId
    };
}
