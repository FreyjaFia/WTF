using WTF.Domain.Entities;

namespace WTF.Tests.Infrastructure;

internal static class CatalogSeed
{
    public const int Drink = 1;
    public const int Food = 2;
    public const int Dessert = 3;
    public const int Other = 4;

    public const int Coffee = 1;
    public const int NonCoffee = 2;
    public const int Snacks = 3;
    public const int Retail = 4;

    public const int Size = 1;
    public const int Flavor = 2;
    public const int Topping = 3;
    public const int Extra = 4;
    public const int Sauce = 5;

    public static List<ProductCategory> Categories() =>
    [
        new() { Id = Drink, Name = "Drink", SortOrder = 1, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Food, Name = "Food", SortOrder = 2, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Dessert, Name = "Dessert", SortOrder = 3, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Other, Name = "Other", SortOrder = 4, IsActive = true, CreatedAt = DateTime.UtcNow },
    ];

    public static List<ProductSubCategory> SubCategories() =>
    [
        new() { Id = Coffee, Name = "Coffee", SortOrder = 1, IsActive = true, CategoryId = Drink, CreatedAt = DateTime.UtcNow },
        new() { Id = NonCoffee, Name = "NonCoffee", SortOrder = 2, IsActive = true, CategoryId = Drink, CreatedAt = DateTime.UtcNow },
        new() { Id = Snacks, Name = "Snacks", SortOrder = 3, IsActive = true, CategoryId = Food, CreatedAt = DateTime.UtcNow },
        new() { Id = Retail, Name = "Retail", SortOrder = 4, IsActive = true, CategoryId = Other, CreatedAt = DateTime.UtcNow },
    ];

    public static List<AddOnType> AddOnTypes() =>
    [
        new() { Id = Size, Name = "Size", IsRequired = true, MinSelect = 1, MaxSelect = 1, SortOrder = 1, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Flavor, Name = "Flavor", IsRequired = true, MinSelect = 1, MaxSelect = 1, SortOrder = 2, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Topping, Name = "Topping", SortOrder = 4, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Extra, Name = "Extra", SortOrder = 5, IsActive = true, CreatedAt = DateTime.UtcNow },
        new() { Id = Sauce, Name = "Sauce", MaxSelect = 1, SortOrder = 3, IsActive = true, CreatedAt = DateTime.UtcNow },
    ];
}
