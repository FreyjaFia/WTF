using WTF.Tests.Infrastructure;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Items;

/// <summary>Seeding helpers for the items/loyalty/sync/audit tests.</summary>
internal static class ItemSeed
{
    public static async Task<User> User(string dbName, Guid? id = null, string first = "Una", string last = "User")
    {
        await using var db = TestDb.Create(dbName);
        var user = new User
        {
            Id = id ?? Guid.NewGuid(), Username = "u" + Guid.NewGuid().ToString("N"), PasswordHash = "x",
            FirstName = first, LastName = last, IsActive = true, RoleId = 1, CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public static async Task<Item> Item(string dbName, Guid userId, string name = "Flour", string? sku = null,
        string? barcode = null, decimal qty = 0, decimal? cost = null, bool active = true)
    {
        await using var db = TestDb.Create(dbName);
        var item = new Item
        {
            Id = Guid.NewGuid(), Name = name, Sku = sku, Barcode = barcode, UnitName = "kg", CurrentQuantity = qty,
            CostPrice = cost, IsActive = active, CreatedAt = DateTime.UtcNow, CreatedBy = userId
        };
        db.Items.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    public static async Task<Product> Product(string dbName, Guid userId, string name = "Latte", string code = "LAT")
    {
        await using var db = TestDb.Create(dbName);
        var p = new Product
        {
            Id = Guid.NewGuid(), Name = name, Code = code, Price = 100, CategoryId = 1, IsActive = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = userId
        };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return p;
    }
}
