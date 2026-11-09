using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

// Throwaway database for the Playwright tests (src/wtf-e2e). Never touches the real WTF database.
//
//   dotnet run --project src/WTF.E2E.Database -- create   prints the new database name and connection string as JSON
//   dotnet run --project src/WTF.E2E.Database -- drop <name>
//
// E2E_SQL        server connection string (default: LocalDB). The database name in it is ignored.
// E2E_PASSWORD   password given to the six test accounts (required for create).
//
// The name starts with WTF_E2E_, not WTF_Test_, so the .NET test run (which drops WTF_Test_* databases older
// than an hour) can never delete it in the middle of a long browser run.

const string Prefix = "WTF_E2E_";
const string DefaultServer = "Server=(localdb)\\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=true";

var server = Environment.GetEnvironmentVariable("E2E_SQL") ?? DefaultServer;
// E2E_DB_TAG (letters only, for example MT) names a separate family of databases, and drop-all only removes the family it is run with.
var tag = Environment.GetEnvironmentVariable("E2E_DB_TAG")?.Trim();

try
{
    switch (args.FirstOrDefault())
    {
        case "create":
            await CreateAsync();
            return 0;
        case "drop" when args.Length == 2:
            await DropAsync(args[1]);
            return 0;
        case "drop-all":
            await DropAllAsync();
            return 0;
        default:
            Console.Error.WriteLine("Usage: create | drop <database name> | drop-all");
            return 2;
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}

string ConnectionStringFor(string database) =>
    new SqlConnectionStringBuilder(server) { InitialCatalog = database }.ConnectionString;

async Task CreateAsync()
{
    var password = Environment.GetEnvironmentVariable("E2E_PASSWORD");
    if (string.IsNullOrWhiteSpace(password))
    {
        throw new InvalidOperationException("Set E2E_PASSWORD (the password of the throwaway test accounts).");
    }

    var name = Prefix + (tag is { Length: > 0 } ? tag + "_" : string.Empty) + DateTime.UtcNow.ToString("yyyyMMddHHmmss") + "_" + Guid.NewGuid().ToString("N")[..6];
    var connectionString = ConnectionStringFor(name);

    try
    {
        await using var db = NewContext(connectionString);
        await db.Database.EnsureCreatedAsync();
        await db.Database.OpenConnectionAsync(); // one connection, so IDENTITY_INSERT applies to the inserts below

        await InsertAsync(db, Named<OrderStatusEnum, Status>((id, n) => new Status { Id = id, Name = n }, OrderStatusEnum.All));
        await InsertAsync(db, Named<PaymentMethodEnum, PaymentMethod>((id, n) => new PaymentMethod { Id = id, Name = n }));
        await SeedDefaultShopAsync(db);
        await InsertAsync(db, new List<ProductCategory>
        {
            new() { Id = 1, Name = "Drink", SortOrder = 1, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 2, Name = "Food", SortOrder = 2, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 3, Name = "Dessert", SortOrder = 3, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 4, Name = "Other", SortOrder = 4, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
        });
        await InsertAsync(db, new List<ProductSubCategory>
        {
            new() { Id = 1, Name = "Coffee", SortOrder = 1, IsActive = true, CategoryId = 1, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 2, Name = "NonCoffee", SortOrder = 2, IsActive = true, CategoryId = 1, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 3, Name = "Snacks", SortOrder = 3, IsActive = true, CategoryId = 2, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 4, Name = "Retail", SortOrder = 4, IsActive = true, CategoryId = 4, TenantId = TenantDefaults.DefaultTenantId },
        });
        await InsertAsync(db, new List<AddOnType>
        {
            new() { Id = 1, Name = "Size", SystemKey = "size", IsRequired = true, MinSelect = 1, MaxSelect = 1, SortOrder = 1, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 2, Name = "Flavor", IsRequired = true, MinSelect = 1, MaxSelect = 1, SortOrder = 2, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 3, Name = "Topping", SortOrder = 4, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 4, Name = "Extra", SystemKey = "extra", SortOrder = 5, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 5, Name = "Sauce", MaxSelect = 1, SortOrder = 3, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
            new() { Id = 6, Name = "Temperature", IsRequired = true, MinSelect = 1, MaxSelect = 1, SortOrder = 0, IsActive = true, CreatedAt = DateTime.UtcNow, TenantId = TenantDefaults.DefaultTenantId },
        });
        await InsertAsync(db, Named<UserRoleEnum, UserRole>((id, n) => new UserRole { Id = id, Name = n }));

        SeedUsers(db, password);
        SeedWasteReasons(db);
        await db.SaveChangesAsync();
    }
    catch
    {
        await DropAsync(name);
        throw;
    }

    Console.WriteLine($"{{\"database\":\"{name}\",\"connectionString\":\"{connectionString.Replace("\\", "\\\\")}\"}}");
}

static async Task SeedDefaultShopAsync(WTFDbContext db)
{
    // The shop every test account belongs to (same fixed id as tools/sql/20261108_add_tenants.sql), on the Pro plan.
    var now = DateTime.UtcNow;
    var pro = new Plan { Code = "pro", Name = "Pro", MonthlyPrice = 2500, Features = "pos,orders,reports,offline,inventory,promotions,orderlinks,chat,workbook", SortOrder = 2, IsActive = true };
    db.Plans.Add(new Plan { Code = "starter", Name = "Starter", MonthlyPrice = 1500, Features = "pos,orders,reports,offline", SortOrder = 1, IsActive = true });
    db.Plans.Add(pro);
    db.Tenants.Add(new Tenant { Id = TenantDefaults.DefaultTenantId, Name = "WTF", Slug = TenantDefaults.DefaultTenantSlug, Status = 2, CreatedAt = now });
    await db.SaveChangesAsync();

    db.TenantSubscriptions.Add(new TenantSubscription
    {
        TenantId = TenantDefaults.DefaultTenantId,
        PlanId = pro.Id,
        CurrentPeriodStart = now,
        CurrentPeriodEnd = now.AddDays(365),
        GraceDays = 7,
        UpdatedAt = now,
    });
    db.TenantSettings.Add(new TenantSetting
    {
        TenantId = TenantDefaults.DefaultTenantId,
        ShopName = "WTF",
        PrimaryColor = "#6f4e37",
        TimeZone = "Asia/Manila",
        CurrencySymbol = "₱",
        CurrencyCode = "PHP",
        CurrencyDecimals = 2,
    });
    await db.SaveChangesAsync();
}

static void SeedUsers(WTFDbContext db, string password)
{
    var hash = BCrypt.Net.BCrypt.HashPassword(password);
    var accounts = new (string Username, UserRoleEnum Role)[]
    {
        ("superadmin", UserRoleEnum.SuperAdmin),
        ("admin", UserRoleEnum.Admin),
        ("cashier", UserRoleEnum.Cashier),
        ("viewer", UserRoleEnum.AdminViewer),
        ("stockmgr", UserRoleEnum.StockManager),
        ("itemmgr", UserRoleEnum.ItemManager),
    };

    foreach (var (username, role) in accounts)
    {
        db.Users.Add(NewUser(username, username, "E2E", hash, role, active: true));
    }

    // Owns orders placed through a customer link. Inactive, and "!" is not a valid hash, so nobody can sign in as it.
    db.Users.Add(NewUser("customer-link", "Customer", "Link", "!", UserRoleEnum.Cashier, active: false));
}

static User NewUser(string username, string firstName, string lastName, string hash, UserRoleEnum role, bool active)
{
    var id = Guid.NewGuid();
    return new User
    {
        Id = id,
        Username = username,
        PasswordHash = hash,
        FirstName = firstName,
        LastName = lastName,
        IsActive = active,
        RoleId = (int)role,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = id,
        TenantId = TenantDefaults.DefaultTenantId,
    };
}

static void SeedWasteReasons(WTFDbContext db)
{
    // Same rows as tools/sql/20261027_add_stock_waste.sql (EnsureCreated builds the table but not its seed).
    var reasons = new (string Name, bool RequiresNote, int SortOrder, bool IsSystem)[]
    {
        ("Expired or spoiled", false, 10, false),
        ("Spilled or dropped", false, 20, false),
        ("Wrong order or remade", false, 30, false),
        ("Quality failed", false, 40, false),
        ("Staff meal", false, 50, false),
        ("Sample or tasting", false, 60, false),
        ("Breakage", false, 70, false),
        ("Other", true, 1000, true),
    };

    foreach (var (name, requiresNote, sortOrder, isSystem) in reasons)
    {
        db.WasteReasons.Add(new WasteReason
        {
            Name = name,
            RequiresNote = requiresNote,
            SortOrder = sortOrder,
            IsSystem = isSystem,
            IsActive = true,
            TenantId = TenantDefaults.DefaultTenantId,
        });
    }
}

// Removes every WTF_E2E_* database, for example the ones an interrupted run left behind.
async Task DropAllAsync()
{
    var names = new List<string>();
    await using (var master = new SqlConnection(ConnectionStringFor("master")))
    {
        await master.OpenAsync();
        await using var list = master.CreateCommand();
        list.CommandText = tag is { Length: > 0 }
            ? "SELECT name FROM sys.databases WHERE name LIKE 'WTF[_]E2E[_]" + tag + "[_]%'"
            : "SELECT name FROM sys.databases WHERE name LIKE 'WTF[_]E2E[_][0-9]%'";
        await using var reader = await list.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }
    }

    foreach (var name in names)
    {
        await DropAsync(name);
        Console.WriteLine($"Dropped leftover {name}");
    }
}

async Task DropAsync(string name)
{
    if (!name.StartsWith(Prefix, StringComparison.Ordinal))
    {
        throw new InvalidOperationException($"Refusing to drop '{name}': only {Prefix}* databases are throwaway.");
    }

    SqlConnection.ClearAllPools();
    await using var master = new SqlConnection(ConnectionStringFor("master"));
    await master.OpenAsync();
    await using var command = master.CreateCommand();
    command.CommandText =
        $"IF DB_ID(N'{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]; END";
    await command.ExecuteNonQueryAsync();
}

static WTFDbContext NewContext(string connectionString)
{
    var options = new DbContextOptionsBuilder<WTFDbContext>().UseSqlServer(connectionString).Options;
    return new ThrowawayContext(options);
}

// The table name comes from the EF model, never from input, so interpolating it is safe (and a parameter cannot name a table).
#pragma warning disable EF1002
static async Task InsertAsync<TEntity>(WTFDbContext db, List<TEntity> rows)
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
#pragma warning restore EF1002

static List<TEntity> Named<TEnum, TEntity>(Func<int, string, TEntity> create, TEnum? skip = null)
    where TEnum : struct, Enum
{
    return Enum.GetValues<TEnum>()
        .Where(value => skip is null || !EqualityComparer<TEnum>.Default.Equals(value, skip.Value))
        .Select(value => create(Convert.ToInt32(value), value.ToString()))
        .ToList();
}

internal sealed class ThrowawayContext(DbContextOptions<WTFDbContext> options) : WTFDbContext(options)
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        // Intentionally empty: the provider and connection are already configured through the options.
    }
}
