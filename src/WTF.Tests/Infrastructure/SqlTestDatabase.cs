using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Tests.Infrastructure;

/// <summary>
/// A throw-away SQL Server database named WTF_Test_&lt;random&gt;, built from the EF model (tables, keys, unique
/// indexes, the OrderNumberSeq sequence and column defaults) and dropped on dispose. Use it for behavior that
/// the in-memory provider cannot show: transactions, constraints, collation, SQL translation, defaults.
///
/// <code>
/// await using var database = await SqlTestDatabase.CreateAsync();
/// await using var db = database.CreateContext();
/// </code>
///
/// The schema comes from the EF model, not from tools/sql (those scripts are incremental, there is no baseline).
/// </summary>
internal sealed class SqlTestDatabase : IAsyncDisposable
{
    private const string Prefix = "WTF_Test_";
    private static int _staleDatabasesDropped;

    private readonly string _connectionString;

    private SqlTestDatabase(string name, string connectionString)
    {
        Name = name;
        _connectionString = connectionString;
    }

    public string Name { get; }

    /// <summary>Creates the database and its tables, and seeds the lookup rows the enums describe.</summary>
    public static async Task<SqlTestDatabase> CreateAsync(bool seedLookups = true)
    {
        await DropStaleDatabasesOnceAsync();

        var name = Prefix + Guid.NewGuid().ToString("N");
        var builder = new SqlConnectionStringBuilder(SqlServerAvailability.ServerConnectionString)
        {
            InitialCatalog = name,
        };

        var database = new SqlTestDatabase(name, builder.ConnectionString);
        try
        {
            await using (var db = database.CreateContext())
            {
                await db.Database.EnsureCreatedAsync();
            }

            if (seedLookups)
            {
                await database.SeedLookupsAsync();
            }

            return database;
        }
        catch
        {
            // The caller never receives the database, so nobody else can drop it.
            await database.DisposeAsync();
            throw;
        }
    }

    /// <summary>A new context over this database. Create one per "request" to avoid shared change tracking.</summary>
    public WTFDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<WTFDbContext>()
            .UseSqlServer(_connectionString)
            .EnableSensitiveDataLogging()
            .Options;

        return new SqlServerWtfDbContext(options);
    }

    /// <summary>Statuses, payment methods, categories, roles and add-on types with the ids the API enums use.</summary>
    private async Task SeedLookupsAsync()
    {
        await using var db = CreateContext();
        await db.Database.OpenConnectionAsync(); // keep one connection so IDENTITY_INSERT applies to the inserts below

        await InsertAsync(db, Named<OrderStatusEnum, Status>(
            (id, name) => new Status { Id = id, Name = name }, skip: OrderStatusEnum.All));
        await InsertAsync(db, Named<PaymentMethodEnum, PaymentMethod>(
            (id, name) => new PaymentMethod { Id = id, Name = name }));
        await InsertAsync(db, Named<ProductCategoryEnum, ProductCategory>(
            (id, name) => new ProductCategory { Id = id, Name = name }));
        await InsertAsync(db, Named<ProductSubCategoryEnum, ProductSubCategory>(
            (id, name) => new ProductSubCategory { Id = id, Name = name }));
        await InsertAsync(db, Named<AddOnTypeEnum, AddOnType>(
            (id, name) => new AddOnType { Id = id, Name = name }));
        await InsertAsync(db, Named<UserRoleEnum, UserRole>(
            (id, name) => new UserRole { Id = id, Name = name }));
    }

    /// <summary>Inserts rows with explicit ids, switching IDENTITY_INSERT on for tables whose id is an identity column.</summary>
    private static async Task InsertAsync<TEntity>(WTFDbContext db, List<TEntity> rows)
        where TEntity : class
    {
        var table = db.Model.FindEntityType(typeof(TEntity))!.GetTableName()!;
        var hasIdentity = await db.Database
            .SqlQueryRaw<int>($"SELECT CAST(OBJECTPROPERTY(OBJECT_ID(N'dbo.{table}'), 'TableHasIdentity') AS int) AS [Value]")
            .SingleAsync() == 1;

        if (hasIdentity)
        {
            await db.Database.ExecuteSqlRawAsync($"SET IDENTITY_INSERT [dbo].[{table}] ON");
        }

        db.Set<TEntity>().AddRange(rows);
        await db.SaveChangesAsync();

        if (hasIdentity)
        {
            await db.Database.ExecuteSqlRawAsync($"SET IDENTITY_INSERT [dbo].[{table}] OFF");
        }
    }

    private static List<TEntity> Named<TEnum, TEntity>(Func<int, string, TEntity> create, TEnum? skip = null)
        where TEnum : struct, Enum
    {
        return Enum.GetValues<TEnum>()
            .Where(value => skip is null || !EqualityComparer<TEnum>.Default.Equals(value, skip.Value))
            .Select(value => create(Convert.ToInt32(value), value.ToString()))
            .ToList();
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await using var master = new SqlConnection(MasterConnectionString());
            await master.OpenAsync();
            await using var command = master.CreateCommand();
            // Close any pooled connections first, otherwise DROP DATABASE fails with "in use".
            command.CommandText = $"ALTER DATABASE [{Name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{Name}];";
            await command.ExecuteNonQueryAsync();
        }
        catch (SqlException)
        {
            // Best effort: a leftover database is removed by DropStaleDatabasesOnceAsync on a later run.
        }
    }

    private static string MasterConnectionString() =>
        new SqlConnectionStringBuilder(SqlServerAvailability.ServerConnectionString) { InitialCatalog = "master" }
            .ConnectionString;

    /// <summary>Removes WTF_Test_* databases left behind by killed runs (older than an hour), once per test process.</summary>
    private static async Task DropStaleDatabasesOnceAsync()
    {
        if (Interlocked.Exchange(ref _staleDatabasesDropped, 1) == 1)
        {
            return;
        }

        try
        {
            await using var master = new SqlConnection(MasterConnectionString());
            await master.OpenAsync();

            var stale = new List<string>();
            await using (var list = master.CreateCommand())
            {
                list.CommandText = "SELECT name FROM sys.databases WHERE name LIKE 'WTF[_]Test[_]%' AND create_date < DATEADD(HOUR, -1, GETDATE())";
                await using var reader = await list.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    stale.Add(reader.GetString(0));
                }
            }

            foreach (var name in stale)
            {
                await using var drop = master.CreateCommand();
                drop.CommandText = $"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];";
                await drop.ExecuteNonQueryAsync();
            }
        }
        catch (SqlException)
        {
            // Not fatal: cleanup is best effort.
        }
    }

    /// <summary>WTFDbContext.OnConfiguring always points at the configured connection string name; use ours.</summary>
    private sealed class SqlServerWtfDbContext(DbContextOptions<WTFDbContext> options) : WTFDbContext(options)
    {
        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            // Intentionally empty: the provider and connection are already configured through the options.
        }
    }
}
