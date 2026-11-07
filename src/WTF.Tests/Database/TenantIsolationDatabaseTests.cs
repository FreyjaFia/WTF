using Microsoft.EntityFrameworkCore;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Tenant query filter and stamping against a real SQL Server (the filter runs as SQL, not in memory).</summary>
public class TenantIsolationDatabaseTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    [SqlFact]
    public async Task Multi_TenantANeverReadsTenantBRows()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var a = database.CreateContext(new Tenant(TenantA)))
        {
            a.Customers.Add(NewCustomer("Ana", user.Id));
            await a.SaveChangesAsync();
        }

        await using (var b = database.CreateContext(new Tenant(TenantB)))
        {
            b.Customers.Add(NewCustomer("Ben", user.Id));
            await b.SaveChangesAsync();
        }

        await using var readA = database.CreateContext(new Tenant(TenantA));
        (await readA.Customers.Select(c => c.FirstName).ToListAsync()).ShouldBe(["Ana"]);

        await using var readB = database.CreateContext(new Tenant(TenantB));
        (await readB.Customers.Select(c => c.FirstName).ToListAsync()).ShouldBe(["Ben"]);

        await using var nobody = database.CreateContext(new Tenant(null));
        (await nobody.Customers.CountAsync()).ShouldBe(0);

        await using var unfiltered = database.CreateContext();
        (await unfiltered.Customers.CountAsync()).ShouldBe(2);
    }

    [SqlFact]
    public async Task Multi_ExecuteUpdateOnlyTouchesTheCurrentTenant()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var a = database.CreateContext(new Tenant(TenantA)))
        {
            a.Customers.Add(NewCustomer("Ana", user.Id));
            await a.SaveChangesAsync();
        }

        await using (var b = database.CreateContext(new Tenant(TenantB)))
        {
            b.Customers.Add(NewCustomer("Ben", user.Id));
            await b.SaveChangesAsync();
        }

        await using (var b = database.CreateContext(new Tenant(TenantB)))
        {
            var changed = await b.Customers.ExecuteUpdateAsync(s => s.SetProperty(c => c.LastName, "Changed"));
            changed.ShouldBe(1);
        }

        await using var all = database.CreateContext();
        (await all.Customers.SingleAsync(c => c.FirstName == "Ana")).LastName.ShouldBe("Test");
    }

    private static Customer NewCustomer(string first, Guid userId) => new()
    {
        Id = Guid.NewGuid(),
        FirstName = first,
        LastName = "Test",
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId,
    };

    private sealed class Tenant(Guid? id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
