using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Tests.Infrastructure;

// An in-memory WTFDbContext for handler tests. The handler's real LINQ queries run against
// tables held in memory (no SQL Server).
//
// Limits to keep in mind: foreign keys and unique indexes are not enforced, transactions are ignored (so a
// rollback cannot be observed), SQL Server defaults (newid(), getutcdate()) are not applied, and text is
// compared case-sensitively. Set every value a handler relies on explicitly when seeding.
internal static class TestDb
{
    public static string NewName() => $"wtf-test-{Guid.NewGuid():N}";

    public static WTFDbContext Create(string? name = null)
    {
        var options = new DbContextOptionsBuilder<WTFDbContext>()
            .UseInMemoryDatabase(name ?? NewName())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .EnableSensitiveDataLogging()
            .Options;

        var db = new InMemoryWtfDbContext(options);
        if (!db.ProductCategories.Any() && !db.AddOnTypes.Any())
        {
            db.Branches.Add(new Branch
            {
                Id = Guid.NewGuid(),
                TenantId = TenantDefaults.DefaultTenantId,
                Name = "Main",
                Code = "MAI",
                TimeZone = "Asia/Manila",
                IsActive = true,
                IsMain = true,
                CreatedAt = DateTime.UtcNow
            });
            db.ProductCategories.AddRange(CatalogSeed.Categories());
            db.ProductSubCategories.AddRange(CatalogSeed.SubCategories());
            db.AddOnTypes.AddRange(CatalogSeed.AddOnTypes());
            db.SaveChanges();
            db.ChangeTracker.Clear();
        }

        return db;
    }

    public static Guid MainBranchId(string dbName)
    {
        using var db = Create(dbName);
        return db.Branches.Single(b => b.IsMain).Id;
    }

    public static void SeedSystemRoles(string dbName)
    {
        using var db = Create(dbName);
        db.UserRoles.AddRange(Enum.GetValues<WTF.Api.Features.Users.Enums.UserRoleEnum>()
            .Select(r => new WTF.Domain.Entities.UserRole { Id = (int)r, Name = r.ToString(), IsSystem = true }));
        db.SaveChanges();
    }

    public static async Task SeedAddOnTypesAsync(string dbName)
    {
        await using var db = Create(dbName);
        db.AddOnTypes.AddRange(CatalogSeed.AddOnTypes());
        await db.SaveChangesAsync();
    }

    public static WTFDbContext Create(string name, ICurrentTenant tenant)
    {
        var options = new DbContextOptionsBuilder<WTFDbContext>()
            .UseInMemoryDatabase(name)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .EnableSensitiveDataLogging()
            .Options;

        return new InMemoryWtfDbContext(options, tenant);
    }

    public static WTFDbContext Create(string name, ICurrentTenant tenant, ICurrentBranch branch)
    {
        var options = new DbContextOptionsBuilder<WTFDbContext>()
            .UseInMemoryDatabase(name)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .EnableSensitiveDataLogging()
            .Options;

        return new InMemoryWtfDbContext(options, tenant, branch);
    }

    public static async Task SaveAsync(string dbName, params object[] entities)
    {
        await using var db = Create(dbName);
        db.AddRange(entities);
        await db.SaveChangesAsync();
    }

    private sealed class InMemoryWtfDbContext : WTFDbContext
    {
        public InMemoryWtfDbContext(DbContextOptions<WTFDbContext> options)
            : base(options)
        {
        }

        public InMemoryWtfDbContext(DbContextOptions<WTFDbContext> options, ICurrentTenant tenant)
            : base(options, tenant)
        {
        }

        public InMemoryWtfDbContext(DbContextOptions<WTFDbContext> options, ICurrentTenant tenant, ICurrentBranch branch)
            : base(options, tenant, branch)
        {
        }

        public override int SaveChanges(bool acceptAllChangesOnSuccess)
        {
            LegacyStockSeeding.AddMainBranchRows(this, true);
            return base.SaveChanges(acceptAllChangesOnSuccess);
        }

        public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
        {
            LegacyStockSeeding.AddMainBranchRows(this, true);
            return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }

        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            // Intentionally empty: the provider is already configured through the options.
        }
    }
}

internal static class StockQuantityExtensions
{
    public static async Task<decimal> QuantityOfAsync(this WTFDbContext db, Guid itemId)
    {
        return await db.ItemBranchStocks.AsNoTracking().Where(s => s.ItemId == itemId).SumAsync(s => s.CurrentQuantity);
    }

    public static async Task<decimal> QuantityOfAsync(this WTFDbContext db, string itemName)
    {
        return await db.ItemBranchStocks.AsNoTracking().Where(s => s.Item.Name == itemName).SumAsync(s => s.CurrentQuantity);
    }

    public static async Task<decimal> QuantityOfOnlyItemAsync(this WTFDbContext db)
    {
        return await db.ItemBranchStocks.AsNoTracking().SumAsync(s => s.CurrentQuantity);
    }
}

// Tests state an item's stock the old way (Item.CurrentQuantity = 12). Stock lives in one row per item and branch now, so
// a new item gets its row in its shop's Main branch when it is saved.
internal static class LegacyStockSeeding
{
    public static void AddMainBranchRows(WTFDbContext db, bool includeZero = false)
    {
        var added = db.ChangeTracker.Entries<Item>().Where(e => e.State == EntityState.Added).Select(e => e.Entity).ToList();
        if (added.Count == 0)
        {
            return;
        }

        var mains = db.Branches.IgnoreQueryFilters().Where(b => b.IsMain).Select(b => new { b.Id, b.TenantId }).ToList();
        foreach (var item in added)
        {
            var tenantId = item.TenantId != Guid.Empty ? item.TenantId : db.StampTenantId ?? TenantDefaults.DefaultTenantId;
            var main = mains.FirstOrDefault(m => m.TenantId == tenantId);
            if (main is null)
            {
                continue;
            }

            if (item.Id == Guid.Empty)
            {
                item.Id = Guid.NewGuid();
            }

            if (!includeZero && item.CurrentQuantity == 0m && item.LastAlertStatus == 0)
            {
                continue;
            }

            if (db.ChangeTracker.Entries<ItemBranchStock>().Any(e => e.State == EntityState.Added && e.Entity.ItemId == item.Id && e.Entity.BranchId == main.Id))
            {
                continue;
            }

            if (item.ItemBranchStocks.Any(s => s.BranchId == main.Id))
            {
                continue;
            }

            db.ItemBranchStocks.Add(new ItemBranchStock
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                ItemId = item.Id,
                BranchId = main.Id,
                CurrentQuantity = item.CurrentQuantity,
                LastAlertStatus = item.LastAlertStatus,
                UpdatedAt = DateTime.UtcNow
            });
        }
    }
}
