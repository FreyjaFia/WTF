using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchWallDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid Makati, Guid Cebu);

    private static async Task<Shop> OpenShopAsync()
    {
        var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using var db = database.CreateContext();
        var makati = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
        var cebu = SqlTestDatabase.MainBranch(Tenant, "CEB");
        cebu.IsMain = false;
        cebu.Name = "Cebu";
        db.Branches.Add(cebu);
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, makati, cebu.Id);
    }

    private static Order NewOrder(Guid userId, Guid? branchId = null) => new()
    {
        Id = Guid.NewGuid(),
        StatusId = (int)OrderStatusEnum.Completed,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId,
        BranchId = branchId ?? Guid.Empty,
    };

    private static async Task<Guid> SaveOrderAsync(Shop shop, ICurrentBranch? branch, Guid? explicitBranch = null)
    {
        await using var db = branch is null
            ? shop.Database.CreateContext(new FixedTenant(Tenant))
            : shop.Database.CreateContext(new FixedTenant(Tenant), branch);
        var order = NewOrder(shop.UserId, explicitBranch);
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return order.Id;
    }

    [SqlFact]
    public async Task NewRows_GoToTheActiveBranch_OrMainWhenNoneIsChosen()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var viaMain = await SaveOrderAsync(shop, null);
        var viaActive = await SaveOrderAsync(shop, new FixedBranch([shop.Cebu], shop.Cebu, false));

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await db.Orders.SingleAsync(o => o.Id == viaMain)).BranchId.ShouldBe(shop.Makati);
        (await db.Orders.SingleAsync(o => o.Id == viaActive)).BranchId.ShouldBe(shop.Cebu);
    }

    [SqlFact]
    public async Task ABranchUser_NeverReadsAnotherBranchsOrders_EvenWithoutAFilterInTheQuery()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var makatiOrder = await SaveOrderAsync(shop, new FixedBranch([shop.Makati], shop.Makati, true));
        var cebuOrder = await SaveOrderAsync(shop, new FixedBranch([shop.Cebu], shop.Cebu, true));

        await using var makati = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati], shop.Makati, true));
        (await makati.Orders.Select(o => o.Id).ToListAsync()).ShouldBe([makatiOrder]);
        (await makati.Orders.AnyAsync(o => o.Id == cebuOrder)).ShouldBeFalse();
        (await makati.Branches.Select(b => b.Id).ToListAsync()).ShouldBe([shop.Makati]);

        await using var cebu = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Cebu], shop.Cebu, true));
        (await cebu.Orders.Select(o => o.Id).ToListAsync()).ShouldBe([cebuOrder]);
    }

    [SqlFact]
    public async Task AllBranches_ReadsBoth_AndTheRowsAddUp()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await SaveOrderAsync(shop, new FixedBranch([shop.Makati], shop.Makati, false));
        await SaveOrderAsync(shop, new FixedBranch([shop.Makati], shop.Makati, false));
        await SaveOrderAsync(shop, new FixedBranch([shop.Cebu], shop.Cebu, false));

        await using var all = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], null, false));
        await using var onlyMakati = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati], shop.Makati, false));
        await using var onlyCebu = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Cebu], shop.Cebu, false));

        (await all.Orders.CountAsync()).ShouldBe(3);
        (await onlyMakati.Orders.CountAsync() + await onlyCebu.Orders.CountAsync()).ShouldBe(await all.Orders.CountAsync());
    }

    [SqlFact]
    public async Task ALimitedUser_CannotWriteInAnotherBranch_OrChangeAnotherBranchsRow()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var cebuOrder = await SaveOrderAsync(shop, new FixedBranch([shop.Cebu], shop.Cebu, true));

        var limited = new FixedBranch([shop.Makati], shop.Makati, true);
        await Should.ThrowAsync<InvalidOperationException>(() => SaveOrderAsync(shop, limited, shop.Cebu));

        await using var allBranches = shop.Database.CreateContext(new FixedTenant(Tenant));
        var tracked = await allBranches.Orders.SingleAsync(o => o.Id == cebuOrder);
        await using var stranger = shop.Database.CreateContext(new FixedTenant(Tenant), limited);
        stranger.Orders.Attach(tracked);
        tracked.Note = "changed by someone from Makati";
        stranger.Entry(tracked).State = EntityState.Modified;
        await Should.ThrowAsync<InvalidOperationException>(() => stranger.SaveChangesAsync());
    }

    [SqlFact]
    public async Task OrderNumbers_AreCountedPerBranch_AndTheSameNumberIsAllowedInTwoBranches()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var makati = new FixedBranch([shop.Makati], shop.Makati, false);
        var cebu = new FixedBranch([shop.Cebu], shop.Cebu, false);
        foreach (var branch in new[] { makati, cebu, makati, makati, cebu })
        {
            await SaveOrderAsync(shop, branch);
        }

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        var numbers = await db.Orders.OrderBy(o => o.OrderNumber).Select(o => new { o.BranchId, o.OrderNumber }).ToListAsync();
        numbers.Where(n => n.BranchId == shop.Makati).Select(n => n.OrderNumber).ShouldBe([1, 2, 3]);
        numbers.Where(n => n.BranchId == shop.Cebu).Select(n => n.OrderNumber).ShouldBe([1, 2]);
    }

    [SqlFact]
    public async Task ABatchForTwoBranches_NumbersEachBranchOnItsOwn()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using (var seed = shop.Database.CreateContext(new FixedTenant(Tenant)))
        {
            seed.Orders.AddRange(NewOrder(shop.UserId, shop.Makati), NewOrder(shop.UserId, shop.Cebu), NewOrder(shop.UserId, shop.Makati));
            await seed.SaveChangesAsync();
        }

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await db.Orders.Where(o => o.BranchId == shop.Makati).Select(o => o.OrderNumber).OrderBy(n => n).ToListAsync()).ShouldBe([1, 2]);
        (await db.Orders.Where(o => o.BranchId == shop.Cebu).Select(o => o.OrderNumber).ToListAsync()).ShouldBe([1]);
    }

    [SqlFact]
    public async Task ABranchCounterContinuesFromWhereTheShopCounterWas()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using (var seed = shop.Database.CreateContext())
        {
            seed.TenantCounters.Add(new TenantCounter { TenantId = Tenant, Name = WTFDbContext.CounterName(shop.Makati), NextValue = 500 });
            await seed.SaveChangesAsync();
        }

        var id = await SaveOrderAsync(shop, new FixedBranch([shop.Makati], shop.Makati, false));

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await db.Orders.SingleAsync(o => o.Id == id)).OrderNumber.ShouldBe(500);
    }

    [Fact]
    public void EveryEntityWithABranchColumn_IsBranchOwned_AndFiltered()
    {
        using var db = TestDb.Create();
        foreach (var entityType in db.Model.GetEntityTypes())
        {
            // ProductBranch lists the branches a product is sold at, so every branch must be able to read all of its rows.
            var hasBranchId = entityType.FindProperty(nameof(IBranchOwned.BranchId)) is not null && entityType.ClrType != typeof(UserBranch) && entityType.ClrType != typeof(ProductBranch);
            var isOwned = typeof(IBranchOwned).IsAssignableFrom(entityType.ClrType);
            isOwned.ShouldBe(hasBranchId, $"{entityType.ClrType.Name}: a BranchId column and IBranchOwned must go together");

            if (isOwned)
            {
                entityType.GetDeclaredQueryFilters().Select(f => f.Key).ShouldContain("Branch", $"{entityType.ClrType.Name} is branch owned but has no branch filter");
            }
        }
    }
}
