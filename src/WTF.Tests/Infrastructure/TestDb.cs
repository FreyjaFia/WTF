using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using WTF.Domain.Data;
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
            db.ProductCategories.AddRange(CatalogSeed.Categories());
            db.ProductSubCategories.AddRange(CatalogSeed.SubCategories());
            db.AddOnTypes.AddRange(CatalogSeed.AddOnTypes());
            db.SaveChanges();
            db.ChangeTracker.Clear();
        }

        return db;
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

        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            // Intentionally empty: the provider is already configured through the options.
        }
    }
}
