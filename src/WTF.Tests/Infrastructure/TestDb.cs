using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using WTF.Domain.Data;

namespace WTF.Tests.Infrastructure;

/// <summary>
/// An in-memory <see cref="WTFDbContext"/> for handler tests. The handler's real LINQ queries run against
/// tables held in memory (no SQL Server).
///
/// Limits to keep in mind: foreign keys and unique indexes are not enforced, transactions are ignored (so a
/// rollback cannot be observed), SQL Server defaults (newid(), getutcdate()) are not applied, and text is
/// compared case-sensitively. Set every value a handler relies on explicitly when seeding.
/// </summary>
internal static class TestDb
{
    /// <summary>A unique database name. Contexts created with the same name share the same data.</summary>
    public static string NewName() => $"wtf-test-{Guid.NewGuid():N}";

    /// <summary>Creates a context. Pass the same name twice to simulate separate requests over the same data.</summary>
    public static WTFDbContext Create(string? name = null)
    {
        var options = new DbContextOptionsBuilder<WTFDbContext>()
            .UseInMemoryDatabase(name ?? NewName())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .EnableSensitiveDataLogging()
            .Options;

        return new InMemoryWtfDbContext(options);
    }

    /// <summary>Saves entities through their own context, so the handler under test starts from clean tracking state.</summary>
    public static async Task SaveAsync(string dbName, params object[] entities)
    {
        await using var db = Create(dbName);
        db.AddRange(entities);
        await db.SaveChangesAsync();
    }

    /// <summary>WTFDbContext.OnConfiguring always selects SQL Server, which cannot coexist with the in-memory provider.</summary>
    private sealed class InMemoryWtfDbContext(DbContextOptions<WTFDbContext> options) : WTFDbContext(options)
    {
        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            // Intentionally empty: the provider is already configured through the options.
        }
    }
}
