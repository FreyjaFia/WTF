using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Expenses;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Expenses;

public class ExpenseHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 20, 4, 0, 0, TimeSpan.Zero);

    private readonly string _db = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly TimeProvider _clock = new FixedTime(Now);

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private async Task SeedUsersAsync()
    {
        await using var db = TestDb.Create(_db);
        Basics(db);
        await db.SaveChangesAsync();
    }

    private CreateExpenseHandler Create() => new(TestDb.Create(_db), TestRequest.As(StaffA, AppRoles.Admin, "Asia/Manila"), _audit, _clock);

    private UpdateExpenseHandler Update() => new(TestDb.Create(_db), TestRequest.As(StaffA, AppRoles.Admin, "Asia/Manila"), _audit, _clock);

    private DeleteExpenseHandler Delete() => new(TestDb.Create(_db), TestRequest.As(StaffA, AppRoles.Admin), _audit, _clock);

    private RestoreExpenseHandler Restore() => new(TestDb.Create(_db), TestRequest.As(StaffA, AppRoles.Admin), _audit, _clock);

    private GetExpensesHandler Get() => new(TestDb.Create(_db));

    private static readonly DateOnly Mar10 = new(2026, 3, 10);

    [Fact]
    public async Task Create_SavesTheExpenseRoundedAndTrimmedAndAuditsIt()
    {
        await SeedUsersAsync();

        var result = await Create().Handle(new CreateExpenseCommand(Mar10, 1, 12500.456m, "  March rent  "), default);

        result.Amount.ShouldBe(12500.46m);
        result.Note.ShouldBe("March rent");
        result.CategoryName.ShouldBe("Rent");
        result.IsActive.ShouldBeTrue();
        result.CreatedByName.ShouldBe("ana");

        await using var db = TestDb.Create(_db);
        var saved = await db.Expenses.SingleAsync();
        saved.ExpenseDate.ShouldBe(Mar10);
        saved.CreatedBy.ShouldBe(StaffA);
        saved.CreatedAt.ShouldBe(Now.UtcDateTime);
        await _audit.Received(1).LogAsync(
            AuditAction.ExpenseCreated,
            AuditEntityType.Expense,
            saved.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            StaffA,
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0, 100, "Choose a category for the expense.")]
    [InlineData(9, 100, "Choose a category for the expense.")]
    [InlineData(1, 0, "The amount must be more than zero.")]
    [InlineData(1, -5, "The amount must be more than zero.")]
    [InlineData(1, 100000001, "The amount is too large.")]
    public async Task Create_InvalidInput_ThrowsAndSavesNothing(byte category, decimal amount, string message)
    {
        await SeedUsersAsync();

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateExpenseCommand(Mar10, category, amount, "x"), default));

        ex.Message.ShouldBe(message);
        await using var db = TestDb.Create(_db);
        (await db.Expenses.CountAsync()).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task Create_OtherWithoutANote_Throws(string? note)
    {
        await SeedUsersAsync();

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateExpenseCommand(Mar10, 8, 50m, note), default));

        ex.Message.ShouldBe("Say what the expense was for when the category is Other.");
    }

    [Fact]
    public async Task Create_OtherWithANote_AndRentWithoutOne_AreAccepted()
    {
        await SeedUsersAsync();

        (await Create().Handle(new CreateExpenseCommand(Mar10, 8, 50m, "Repair"), default)).Note.ShouldBe("Repair");
        (await Create().Handle(new CreateExpenseCommand(Mar10, 1, 50m, null), default)).Note.ShouldBeNull();
    }

    [Fact]
    public async Task Create_NoteTooLong_Throws()
    {
        await SeedUsersAsync();

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateExpenseCommand(Mar10, 1, 50m, new string('a', 201)), default));

        ex.Message.ShouldBe("The note can be at most 200 characters.");
    }

    [Theory]
    [InlineData("1999-12-31")]
    [InlineData("2027-03-21")]
    public async Task Create_ADateTooFarBackOrAhead_Throws(string date)
    {
        await SeedUsersAsync();

        await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateExpenseCommand(DateOnly.Parse(date), 1, 50m, null), default));
    }

    [Fact]
    public async Task Create_TodayInTheShopTimeZone_IsAcceptedEvenWhenUtcIsStillYesterday()
    {
        await SeedUsersAsync();

        // 20 Mar 04:00 UTC is 12:00 in Manila: 20 Mar is today there and a day ahead is fine.
        var result = await Create().Handle(new CreateExpenseCommand(new DateOnly(2026, 3, 21), 1, 50m, null), default);

        result.ExpenseDate.ShouldBe(new DateOnly(2026, 3, 21));
    }

    [Fact]
    public async Task Update_ChangesTheFieldsAndAuditsBeforeAndAfter()
    {
        await SeedUsersAsync();
        var created = await Create().Handle(new CreateExpenseCommand(Mar10, 3, 800m, "Water"), default);

        var result = await Update().Handle(new UpdateExpenseCommand(created.Id, Mar10.AddDays(1), 3, 950m, "Water and power"), default);

        result!.Amount.ShouldBe(950m);
        result.Note.ShouldBe("Water and power");
        await using var db = TestDb.Create(_db);
        var saved = await db.Expenses.SingleAsync();
        saved.ExpenseDate.ShouldBe(Mar10.AddDays(1));
        saved.UpdatedBy.ShouldBe(StaffA);
        saved.UpdatedAt.ShouldBe(Now.UtcDateTime);
        await _audit.Received(1).LogAsync(
            AuditAction.ExpenseUpdated,
            AuditEntityType.Expense,
            created.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            StaffA,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Update_Unknown_ReturnsNull()
    {
        await SeedUsersAsync();

        (await Update().Handle(new UpdateExpenseCommand(Guid.NewGuid(), Mar10, 1, 50m, null), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Update_ADeletedExpense_Throws()
    {
        await SeedUsersAsync();
        var created = await Create().Handle(new CreateExpenseCommand(Mar10, 1, 50m, null), default);
        await Delete().Handle(new DeleteExpenseCommand(created.Id), default);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Update().Handle(new UpdateExpenseCommand(created.Id, Mar10, 1, 60m, null), default));

        ex.Message.ShouldBe("This expense was deleted. Restore it before changing it.");
    }

    [Fact]
    public async Task Update_InvalidInput_LeavesTheExpenseAsItWas()
    {
        await SeedUsersAsync();
        var created = await Create().Handle(new CreateExpenseCommand(Mar10, 1, 50m, null), default);

        await Should.ThrowAsync<InvalidOperationException>(
            () => Update().Handle(new UpdateExpenseCommand(created.Id, Mar10, 1, -1m, null), default));

        await using var db = TestDb.Create(_db);
        (await db.Expenses.SingleAsync()).Amount.ShouldBe(50m);
    }

    [Fact]
    public async Task Delete_IsASoftDeleteAndAuditsOnce_AndDeletingAgainDoesNothing()
    {
        await SeedUsersAsync();
        var created = await Create().Handle(new CreateExpenseCommand(Mar10, 1, 50m, null), default);

        var first = await Delete().Handle(new DeleteExpenseCommand(created.Id), default);
        var second = await Delete().Handle(new DeleteExpenseCommand(created.Id), default);

        first!.IsActive.ShouldBeFalse();
        second!.IsActive.ShouldBeFalse();
        await using var db = TestDb.Create(_db);
        (await db.Expenses.CountAsync()).ShouldBe(1);
        await _audit.Received(1).LogAsync(
            AuditAction.ExpenseDeleted,
            AuditEntityType.Expense,
            created.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            StaffA,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Restore_BringsItBackAndAuditsOnce()
    {
        await SeedUsersAsync();
        var created = await Create().Handle(new CreateExpenseCommand(Mar10, 1, 50m, null), default);
        await Delete().Handle(new DeleteExpenseCommand(created.Id), default);

        var restored = await Restore().Handle(new RestoreExpenseCommand(created.Id), default);
        await Restore().Handle(new RestoreExpenseCommand(created.Id), default);

        restored!.IsActive.ShouldBeTrue();
        await _audit.Received(1).LogAsync(
            AuditAction.ExpenseRestored,
            AuditEntityType.Expense,
            created.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            StaffA,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAndRestore_Unknown_ReturnNull()
    {
        await SeedUsersAsync();

        (await Delete().Handle(new DeleteExpenseCommand(Guid.NewGuid()), default)).ShouldBeNull();
        (await Restore().Handle(new RestoreExpenseCommand(Guid.NewGuid()), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Get_FiltersByDatesAndCategory_AndTotalsByCategory()
    {
        await SeedUsersAsync();
        await Create().Handle(new CreateExpenseCommand(new DateOnly(2026, 3, 1), 1, 10000m, null), default);
        await Create().Handle(new CreateExpenseCommand(new DateOnly(2026, 3, 5), 3, 800m, null), default);
        await Create().Handle(new CreateExpenseCommand(new DateOnly(2026, 3, 9), 3, 200m, null), default);
        await Create().Handle(new CreateExpenseCommand(new DateOnly(2026, 2, 28), 2, 5000m, null), default);

        var march = await Get().Handle(new GetExpensesQuery(new DateTime(2026, 3, 1), new DateTime(2026, 3, 31), null, null), default);
        var utilities = await Get().Handle(new GetExpensesQuery(new DateTime(2026, 3, 1), new DateTime(2026, 3, 31), 3, null), default);

        march.Items.Count.ShouldBe(3);
        march.Items.Select(i => i.ExpenseDate).ShouldBe([new DateOnly(2026, 3, 9), new DateOnly(2026, 3, 5), new DateOnly(2026, 3, 1)]);
        march.Total.ShouldBe(11000m);
        march.ByCategory.Select(c => (c.CategoryName, c.Count, c.Amount)).ShouldBe([("Rent", 1, 10000m), ("Utilities", 2, 1000m)]);
        utilities.Items.Count.ShouldBe(2);
        utilities.Total.ShouldBe(1000m);
    }

    [Fact]
    public async Task Get_DeletedExpenses_AreHiddenByDefaultAndNeverCounted()
    {
        await SeedUsersAsync();
        await Create().Handle(new CreateExpenseCommand(Mar10, 1, 100m, null), default);
        var gone = await Create().Handle(new CreateExpenseCommand(Mar10, 1, 900m, null), default);
        await Delete().Handle(new DeleteExpenseCommand(gone.Id), default);

        var hidden = await Get().Handle(new GetExpensesQuery(null, null, null, null), default);
        var shown = await Get().Handle(new GetExpensesQuery(null, null, null, true), default);

        hidden.Items.Count.ShouldBe(1);
        hidden.Total.ShouldBe(100m);
        shown.Items.Count.ShouldBe(2);
        shown.Total.ShouldBe(100m);
        shown.Items.Single(i => !i.IsActive).Amount.ShouldBe(900m);
    }

    [Fact]
    public async Task Get_Nothing_ReturnsAnEmptyListWithAZeroTotal()
    {
        await SeedUsersAsync();

        var result = await Get().Handle(new GetExpensesQuery(null, null, null, null), default);

        result.Items.ShouldBeEmpty();
        result.Total.ShouldBe(0m);
        result.ByCategory.ShouldBeEmpty();
    }

    [Fact]
    public async Task Categories_ListsTheEightWithTheNoteRule()
    {
        var categories = await new GetExpenseCategoriesHandler().Handle(new GetExpenseCategoriesQuery(), default);

        categories.Count.ShouldBe(8);
        categories.Single(c => c.NeedsNote).Name.ShouldBe("Other");
    }
}
