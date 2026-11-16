using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

// Demo data for the STAGING database only. Run by the "Build and Deploy" workflow after the SQL scripts.
//
//   STAGING_SQL        connection string of the staging database (required)
//   STAGING_PASSWORD   password for every demo account (required, at least 12 characters, never stored in the repo)
//
// Safe to run again and again: a row is added only when it does not exist yet. Nothing is updated or deleted, so
// existing data and existing passwords are left alone.

const string PlatformUsername = "platformadmin";
const string OwnerUsername = "admin";

var connectionString = Environment.GetEnvironmentVariable("STAGING_SQL");
var password = Environment.GetEnvironmentVariable("STAGING_PASSWORD");
if (string.IsNullOrWhiteSpace(connectionString) || string.IsNullOrEmpty(password) || password.Length < 12)
{
    Console.Error.WriteLine("Set STAGING_SQL and STAGING_PASSWORD (at least 12 characters).");
    return 1;
}

var options = new DbContextOptionsBuilder<WTFDbContext>().UseSqlServer(connectionString).Options;
await using var db = new SeedContext(options);

var tenantId = TenantDefaults.DefaultTenantId;
if (!await db.Tenants.AnyAsync(t => t.Id == tenantId))
{
    Console.Error.WriteLine("The default shop does not exist. Apply the SQL scripts in tools/sql first.");
    return 1;
}

var added = new List<string>();
var now = DateTime.UtcNow;
var hash = BCrypt.Net.BCrypt.HashPassword(password);

// Platform admin (outside every shop)
if (!await db.PlatformAdmins.AnyAsync(p => p.Username == PlatformUsername))
{
    db.PlatformAdmins.Add(new PlatformAdmin { Username = PlatformUsername, PasswordHash = hash, IsActive = true, CreatedAt = now });
    added.Add($"platform admin {PlatformUsername}");
}

// Shop on the biggest plan so every feature can be tested
var businessPlan = await db.Plans.OrderByDescending(p => p.SortOrder).FirstOrDefaultAsync(p => p.IsActive);
var subscription = await db.TenantSubscriptions.FirstOrDefaultAsync(s => s.TenantId == tenantId);
if (subscription is null && businessPlan is not null)
{
    db.TenantSubscriptions.Add(new TenantSubscription
    {
        TenantId = tenantId,
        PlanId = businessPlan.Id,
        CurrentPeriodStart = now,
        CurrentPeriodEnd = now.AddDays(365),
        GraceDays = 7,
        UpdatedAt = now,
    });
    added.Add($"subscription on plan {businessPlan.Name}");
}

await db.SaveChangesAsync();

// Accounts: one per role, same password
var accounts = new (string Username, string First, UserRoleEnum Role)[]
{
    (OwnerUsername, "Admin", UserRoleEnum.Owner),
    ("manager", "Manager", UserRoleEnum.Admin),
    ("cashier", "Cashier", UserRoleEnum.Cashier),
    ("viewer", "Viewer", UserRoleEnum.AdminViewer),
    ("stockmgr", "Stock", UserRoleEnum.StockManager),
    ("itemmgr", "Item", UserRoleEnum.ItemManager),
};

foreach (var (username, first, role) in accounts)
{
    if (await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Username == username))
    {
        continue;
    }

    var id = Guid.NewGuid();
    db.Users.Add(new User
    {
        Id = id,
        Username = username,
        PasswordHash = hash,
        FirstName = first,
        LastName = "Staging",
        IsActive = true,
        RoleId = (int)role,
        CreatedAt = now,
        CreatedBy = id,
        TenantId = tenantId,
    });
    added.Add($"user {username} ({role})");
}

await db.SaveChangesAsync();

var owner = await db.Users.IgnoreQueryFilters().FirstAsync(u => u.Username == OwnerUsername);

// Menu
var categories = new Dictionary<string, ProductCategory>();
foreach (var (name, sort) in new[] { ("Drink", 1), ("Food", 2), ("Dessert", 3), ("Other", 4) })
{
    var category = await db.ProductCategories.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Name == name);
    if (category is null)
    {
        category = new ProductCategory { Name = name, SortOrder = sort, IsActive = true, CreatedAt = now, TenantId = tenantId };
        db.ProductCategories.Add(category);
        added.Add($"category {name}");
    }

    categories[name] = category;
}

await db.SaveChangesAsync();

var products = new (string Code, string Name, decimal Price, string Category, bool SeniorPwd)[]
{
    ("STG-ESP", "Espresso", 90m, "Drink", true),
    ("STG-LAT", "Latte", 140m, "Drink", true),
    ("STG-CAP", "Cappuccino", 140m, "Drink", true),
    ("STG-ICE", "Iced Americano", 120m, "Drink", true),
    ("STG-MAT", "Matcha Latte", 160m, "Drink", true),
    ("STG-CRO", "Croissant", 95m, "Food", true),
    ("STG-SND", "Ham and Cheese Sandwich", 180m, "Food", true),
    ("STG-CAK", "Chocolate Cake Slice", 150m, "Dessert", true),
    ("STG-BEA", "Coffee Beans 250g", 480m, "Other", false),
};

foreach (var (code, name, price, category, seniorPwd) in products)
{
    if (await db.Products.IgnoreQueryFilters().AnyAsync(p => p.TenantId == tenantId && p.Code == code))
    {
        continue;
    }

    db.Products.Add(new Product
    {
        Id = Guid.NewGuid(),
        Code = code,
        Name = name,
        Price = price,
        CategoryId = categories[category].Id,
        IsActive = true,
        IsSeniorPwdEligible = seniorPwd,
        CreatedAt = now,
        CreatedBy = owner.Id,
        TenantId = tenantId,
    });
    added.Add($"product {name}");
}

// Customers (with and without address and last name)
var customers = new (string First, string? Last, string? Address, string? Phone)[]
{
    ("Maria", "Santos", "12 Rizal Street, Barangay Poblacion, Makati City", "09171234567"),
    ("Juan", "Dela Cruz", "45 Mabini Avenue, Quezon City", "09181234567"),
    ("Ana", null, null, null),
};

foreach (var (first, last, address, phone) in customers)
{
    if (await db.Customers.IgnoreQueryFilters().AnyAsync(c => c.TenantId == tenantId && c.FirstName == first && c.LastName == last))
    {
        continue;
    }

    db.Customers.Add(new Customer
    {
        Id = Guid.NewGuid(),
        FirstName = first,
        LastName = last,
        Address = address,
        ContactNumber = phone,
        IsActive = true,
        CreatedAt = now,
        CreatedBy = owner.Id,
        TenantId = tenantId,
    });
    added.Add($"customer {first} {last}".TrimEnd());
}

// Stock items: one fine, one low, one critical, so the alerts can be seen
var items = new (string Name, string Unit, decimal Quantity, decimal Warning, decimal Critical, decimal Cost)[]
{
    ("Espresso Beans", "g", 5000m, 1000m, 300m, 0.9m),
    ("Fresh Milk", "ml", 800m, 1000m, 300m, 0.08m),
    ("Matcha Powder", "g", 100m, 300m, 150m, 3.5m),
};

foreach (var (name, unit, quantity, warning, critical, cost) in items)
{
    if (await db.Items.IgnoreQueryFilters().AnyAsync(i => i.TenantId == tenantId && i.Name == name))
    {
        continue;
    }

    db.Items.Add(new Item
    {
        Id = Guid.NewGuid(),
        Name = name,
        UnitName = unit,
        CurrentQuantity = quantity,
        WarningQuantity = warning,
        CriticalQuantity = critical,
        CostPrice = cost,
        YieldPercent = 100m,
        IsActive = true,
        CreatedAt = now,
        CreatedBy = owner.Id,
        TenantId = tenantId,
    });
    added.Add($"stock item {name}");
}

await db.SaveChangesAsync();

Console.WriteLine(added.Count == 0 ? "Nothing to add, staging already has the demo data." : "Added: " + string.Join(", ", added));
return 0;

internal sealed class SeedContext(DbContextOptions<WTFDbContext> options) : WTFDbContext(options)
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        // The provider is already configured through the options.
    }
}
