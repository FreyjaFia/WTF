using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Customers;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Customer queries against a real SQL Server: SQL translation and collation.</summary>
public class CustomerDatabaseTests
{
    private static async Task SeedAsync(SqlTestDatabase database, Guid userId, string first, string last,
        string? address = null, bool active = true)
    {
        await using var db = database.CreateContext();
        db.Customers.Add(new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = first,
            LastName = last,
            Address = address,
            IsActive = active,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        });
        await db.SaveChangesAsync();
    }

    private static async Task<List<string>> SearchAsync(SqlTestDatabase database, Guid userId, string? term, bool? active = true)
    {
        await using var db = database.CreateContext();
        var result = await new GetCustomersHandler(db, TestRequest.As(userId))
            .Handle(new GetCustomersQuery { SearchTerm = term, IsActive = active }, CancellationToken.None);
        return result.Select(c => c.FirstName).ToList();
    }

    [SqlTheory]
    [InlineData("ana")]
    [InlineData("ANA")]
    [InlineData("cru")]
    public async Task GetCustomers_SearchTerm_MatchesAnyPartIgnoringCase(string term)
    {
        // The search used Contains(string, StringComparison), which SQL Server cannot translate, so every search
        // with a term threw. It now translates (ToLower().Contains) and matches regardless of case.
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SeedAsync(database, user.Id, "Ana", "Cruz");
        await SeedAsync(database, user.Id, "Ben", "Reyes");

        (await SearchAsync(database, user.Id, term)).ShouldBe(["Ana"]);
    }

    [SqlFact]
    public async Task GetCustomers_WithoutSearchTerm_ListsOnlyActiveCustomersByDefault()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SeedAsync(database, user.Id, "Ana", "Cruz");
        await SeedAsync(database, user.Id, "Ann", "Cole", active: false);

        (await SearchAsync(database, user.Id, null)).ShouldBe(["Ana"]);
        (await SearchAsync(database, user.Id, null, active: false)).ShouldBe(["Ann"]);
    }

    [SqlFact]
    public async Task CustomerLifecycle_SoftDeleteThenRestore_KeepsTheRowAndHidesItMeanwhile()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SeedAsync(database, user.Id, "Ana", "Cruz");
        Guid id;
        await using (var db = database.CreateContext())
        {
            id = (await db.Customers.SingleAsync()).Id;
        }

        await using (var db = database.CreateContext())
        {
            await new DeleteCustomerHandler(db, TestRequest.As(user.Id), TestFakes.Audit())
                .Handle(new DeleteCustomerCommand(id), CancellationToken.None);
        }

        (await SearchAsync(database, user.Id, null)).ShouldBeEmpty();

        await using (var db = database.CreateContext())
        {
            await new RestoreCustomerHandler(db, TestRequest.As(user.Id), TestFakes.Audit())
                .Handle(new RestoreCustomerCommand(id), CancellationToken.None);
        }

        (await SearchAsync(database, user.Id, null)).ShouldBe(["Ana"]);
    }

    [SqlFact]
    public async Task CreateCustomer_UnknownCreator_IsRejectedByTheForeignKey()
    {
        await using var database = await SqlTestDatabase.CreateAsync();

        await using var db = database.CreateContext();
        var handler = new CreateCustomerHandler(db, TestRequest.As(Guid.NewGuid()), TestFakes.Audit());

        await Should.ThrowAsync<DbUpdateException>(() =>
            handler.Handle(new CreateCustomerCommand("Ana", "Cruz", null), CancellationToken.None));
    }
}
