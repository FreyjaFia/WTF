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
        await SeedTenantsAsync(database);

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
        await SeedTenantsAsync(database);
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

    [SqlFact]
    public async Task Multi_EachTenantNumbersItsOrdersFromOne_AndTheSameNumberIsAllowedInTwoTenants()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SeedTenantsAsync(database);

        foreach (var tenant in new[] { TenantA, TenantB, TenantA })
        {
            await using var db = database.CreateContext(new Tenant(tenant));
            db.Orders.Add(new Order { Id = Guid.NewGuid(), StatusId = 1, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id });
            await db.SaveChangesAsync();
        }

        await using var all = database.CreateContext();
        var numbers = await all.Orders.OrderBy(o => o.CreatedAt).Select(o => new { o.TenantId, o.OrderNumber }).ToListAsync();
        numbers.Where(n => n.TenantId == TenantA).Select(n => n.OrderNumber).ShouldBe([1, 2]);
        numbers.Where(n => n.TenantId == TenantB).Select(n => n.OrderNumber).ShouldBe([1]);
    }

    private static async Task SeedTenantsAsync(SqlTestDatabase database)
    {
        await using var db = database.CreateContext();
        db.Tenants.AddRange(
            new WTF.Domain.Entities.Tenant { Id = TenantA, Name = "Shop A", Slug = "shop-a", Status = 2, CreatedAt = DateTime.UtcNow },
            new WTF.Domain.Entities.Tenant { Id = TenantB, Name = "Shop B", Slug = "shop-b", Status = 2, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
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
