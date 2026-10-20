using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Item creation against a real SQL Server: the transaction and the filtered unique indexes.</summary>
public class ItemDatabaseTests
{
    private const string MovementRule =
        "ALTER TABLE dbo.StockMovements ADD CONSTRAINT CK_Test_MaxInitial CHECK (QuantityAfter <= 100)";

    private static CreateItemHandler Handler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId), TestFakes.Audit(), TestFakes.Alerts(db));

    private static Item Row(Guid userId, string? sku, string? barcode, string name = "Flour") => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Sku = sku,
        Barcode = barcode,
        UnitName = "kg",
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId,
    };

    [SqlFact]
    public async Task Handle_MovementSaveFails_RollsBackTheItemInsert()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        // The item row and the movement row have the same column types, so make only the movement insert fail
        // with a table rule: no stock movement may end above 100.
        await using (var setup = database.CreateContext())
        {
            await setup.Database.ExecuteSqlRawAsync(MovementRule);
        }

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<DbUpdateException>(() => Handler(db, user.Id).Handle(
                new CreateItemCommand { Name = "Flour", UnitName = "kg", Sku = "F-1", StartingQuantity = 500 },
                CancellationToken.None));
            ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBe(547);
        }

        await using var check = database.CreateContext();
        (await check.Items.CountAsync()).ShouldBe(0);
        (await check.StockMovements.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task Handle_MovementSaveFails_ReleasesTheSkuForALaterCreate()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var setup = database.CreateContext())
        {
            await setup.Database.ExecuteSqlRawAsync(MovementRule);
        }

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<DbUpdateException>(() => Handler(db, user.Id).Handle(
                new CreateItemCommand { Name = "Flour", UnitName = "kg", Sku = "F-1", StartingQuantity = 500 },
                CancellationToken.None));
        }

        await using (var db = database.CreateContext())
        {
            var dto = await Handler(db, user.Id).Handle(
                new CreateItemCommand { Name = "Flour", UnitName = "kg", Sku = "F-1", StartingQuantity = 50 },
                CancellationToken.None);
            dto.Sku.ShouldBe("F-1");
        }

        await using var check = database.CreateContext();
        (await check.Items.CountAsync()).ShouldBe(1);
        (await check.StockMovements.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task Handle_SkuDifferingOnlyInCase_IsRejectedByTheCheck()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(
                new CreateItemCommand { Name = "Flour", UnitName = "kg", Sku = "F-1" }, CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler(db, user.Id).Handle(
                new CreateItemCommand { Name = "Other", UnitName = "kg", Sku = "f-1" }, CancellationToken.None));
            ex.Message.ShouldBe("Item SKU already exists.");
        }
    }

    [SqlFact]
    public async Task Items_DuplicateSkuInsertedDirectly_IsRejectedByTheUniqueIndex()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var db = database.CreateContext())
        {
            db.Items.Add(Row(user.Id, "F-1", null));
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            db.Items.Add(Row(user.Id, "f-1", null)); // the collation makes the index case-insensitive too
            var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
            ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBeOneOf(2601, 2627);
        }
    }

    [SqlFact]
    public async Task Items_DuplicateBarcodeInsertedDirectly_IsRejectedByTheUniqueIndex()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var db = database.CreateContext())
        {
            db.Items.Add(Row(user.Id, null, "123456"));
            await db.SaveChangesAsync();
        }

        await using (var db = database.CreateContext())
        {
            db.Items.Add(Row(user.Id, null, "123456"));
            var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
            ex.InnerException.ShouldBeOfType<SqlException>().Number.ShouldBeOneOf(2601, 2627);
        }
    }

    [SqlFact]
    public async Task Items_ManyRowsWithoutSkuOrBarcode_AreAllowedByTheFilteredIndexes()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(
                new CreateItemCommand { Name = "A", UnitName = "kg", Sku = " ", Barcode = " " }, CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(new CreateItemCommand { Name = "B", UnitName = "kg" }, CancellationToken.None);
        }

        await using var check = database.CreateContext();
        (await check.Items.CountAsync()).ShouldBe(2);
    }

    [SqlFact]
    public async Task Handle_TwoCreatesWithTheSameSkuAtOnce_StoreExactlyOneItem()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using var dbA = database.CreateContext();
        await using var dbB = database.CreateContext();
        var command = new CreateItemCommand { Name = "Flour", UnitName = "kg", Sku = "F-1", StartingQuantity = 5 };

        var results = await Task.WhenAll(
            Attempt(() => Handler(dbA, user.Id).Handle(command, CancellationToken.None)),
            Attempt(() => Handler(dbB, user.Id).Handle(command, CancellationToken.None)));

        // Either the in-code check or the unique index stops the loser; never two rows, never a stray movement.
        results.Count(e => e is null).ShouldBe(1);
        // When both checks pass before either insert, the loser is a DbUpdateException from the index instead.
        var loser = results.Single(e => e is not null);
        (loser is InvalidOperationException or DbUpdateException).ShouldBeTrue(loser!.ToString());

        await using var check = database.CreateContext();
        (await check.Items.CountAsync()).ShouldBe(1);
        (await check.StockMovements.CountAsync()).ShouldBe(1);
    }

    private static async Task<Exception?> Attempt(Func<Task> action)
    {
        try
        {
            await Task.Yield();
            await action();
            return null;
        }
        catch (Exception ex)
        {
            return ex;
        }
    }
}
