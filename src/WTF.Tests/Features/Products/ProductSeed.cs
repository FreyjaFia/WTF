using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

/// <summary>Seeding helpers shared by the product handler tests. Every value is set explicitly (no SQL defaults in-memory).</summary>
internal static class ProductSeed
{
    public static Product NewProduct(string name = "Latte", string code = "LAT", decimal price = 100m,
        int categoryId = 1, bool isAddOn = false, bool isActive = true, Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(),
        Name = name,
        Code = code,
        Price = price,
        CategoryId = categoryId,
        IsAddOn = isAddOn,
        IsActive = isActive,
        CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        CreatedBy = Guid.NewGuid()
    };

    public static User NewUser(Guid id, string first = "Ada", string last = "Lovelace") => new()
    {
        Id = id,
        Username = $"user-{id:N}",
        PasswordHash = "x",
        FirstName = first,
        LastName = last,
        IsActive = true,
        RoleId = 1,
        CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        CreatedBy = id
    };

    public static ProductAddOn NewLink(Guid productId, Guid addOnId, int? typeId = 4, bool isActive = true) => new()
    {
        ProductId = productId,
        AddOnId = addOnId,
        AddOnTypeId = typeId,
        IsActive = isActive
    };

    public static ProductAddOnPriceOverride NewOverride(Guid productId, Guid addOnId, decimal price, bool isActive = true) => new()
    {
        Id = Guid.NewGuid(),
        ProductId = productId,
        AddOnId = addOnId,
        Price = price,
        IsActive = isActive,
        CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc)
    };

    public static ProductImage NewImage(Guid productId, string url, out Image image)
    {
        image = new Image { ImageId = Guid.NewGuid(), ImageUrl = url, UploadedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
        return new ProductImage { ProductId = productId, ImageId = image.ImageId };
    }

    /// <summary>Saves the entities through their own context so handlers under test start from clean state.</summary>
    public static Task SeedAsync(string dbName, params object[] entities) => TestDb.SaveAsync(dbName, entities);
}
