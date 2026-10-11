using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Seeds the rows the database tests need. Every foreign key is enforced here, so parents must exist first.</summary>
internal static class SqlSeed
{
    public static async Task<User> UserAsync(
        SqlTestDatabase database, string username = "alem", int roleId = 1, bool active = true)
    {
        await using var db = database.CreateContext();
        var id = Guid.NewGuid();
        var user = new User
        {
            Id = id,
            Username = username,
            PasswordHash = "x",
            FirstName = "Al",
            LastName = "Em",
            IsActive = active,
            RoleId = roleId,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = id,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public static async Task<Product> ProductAsync(
        SqlTestDatabase database, Guid createdBy, string name, decimal price, string? code = null)
    {
        await using var db = database.CreateContext();
        var product = new Product
        {
            Id = Guid.NewGuid(),
            Name = name,
            Code = code ?? name.ToUpperInvariant(),
            Price = price,
            CategoryId = 1,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = createdBy,
        };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product;
    }
}
