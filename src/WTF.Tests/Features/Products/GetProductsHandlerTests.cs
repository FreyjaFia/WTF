using WTF.Api.Features.Products;
using WTF.Api.Features.Products.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetProductsHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetProductsHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    [Fact]
    public async Task Handle_NoProducts_ReturnsEmptyList()
    {
        var result = await Handler().Handle(new GetProductsQuery(), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_DefaultQuery_ReturnsOnlyActiveProductsOrderedByName()
    {
        await ProductSeed.SeedAsync(_dbName,
            ProductSeed.NewProduct(name: "Mocha", code: "M"),
            ProductSeed.NewProduct(name: "Americano", code: "A"),
            ProductSeed.NewProduct(name: "Zombie", code: "Z", isActive: false));

        var result = await Handler().Handle(new GetProductsQuery(), CancellationToken.None);

        result.Select(p => p.Name).ShouldBe(["Americano", "Mocha"]);
    }

    [Fact]
    public async Task Handle_IsActiveNull_ReturnsActiveAndInactive()
    {
        await ProductSeed.SeedAsync(_dbName,
            ProductSeed.NewProduct(name: "A", code: "A"),
            ProductSeed.NewProduct(name: "B", code: "B", isActive: false));

        var result = await Handler().Handle(new GetProductsQuery { IsActive = null }, CancellationToken.None);

        result.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_IsActiveFalse_ReturnsOnlyInactive()
    {
        await ProductSeed.SeedAsync(_dbName,
            ProductSeed.NewProduct(name: "A", code: "A"),
            ProductSeed.NewProduct(name: "B", code: "B", isActive: false));

        var result = await Handler().Handle(new GetProductsQuery { IsActive = false }, CancellationToken.None);

        result.Select(p => p.Name).ShouldBe(["B"]);
    }

    // In-memory string matching is case-sensitive; on SQL Server the (case-insensitive collation) search would also match "latte".
    [Fact]
    public async Task Handle_SearchTerm_FiltersByNameSubstring()
    {
        await ProductSeed.SeedAsync(_dbName,
            ProductSeed.NewProduct(name: "Iced Latte", code: "L1"),
            ProductSeed.NewProduct(name: "Latte Art", code: "L2"),
            ProductSeed.NewProduct(name: "Espresso", code: "E1"));

        var result = await Handler().Handle(new GetProductsQuery { SearchTerm = "Latte" }, CancellationToken.None);

        result.Select(p => p.Name).ShouldBe(["Iced Latte", "Latte Art"]);
    }

    [Fact]
    public async Task Handle_WhitespaceSearchTerm_IsIgnored()
    {
        await ProductSeed.SeedAsync(_dbName,
            ProductSeed.NewProduct(name: "A", code: "A"),
            ProductSeed.NewProduct(name: "B", code: "B"));

        var result = await Handler().Handle(new GetProductsQuery { SearchTerm = "   " }, CancellationToken.None);

        result.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_Category_FiltersByCategory()
    {
        await ProductSeed.SeedAsync(_dbName,
            ProductSeed.NewProduct(name: "Latte", code: "L", categoryId: (int)ProductCategoryEnum.Drink),
            ProductSeed.NewProduct(name: "Cake", code: "C", categoryId: (int)ProductCategoryEnum.Dessert));

        var result = await Handler().Handle(new GetProductsQuery { Category = ProductCategoryEnum.Dessert }, CancellationToken.None);

        result.Select(p => p.Name).ShouldBe(["Cake"]);
    }

    [Fact]
    public async Task Handle_IsAddOnTrue_ReturnsAddOnsWithLinkedProductCount()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var p1 = ProductSeed.NewProduct(name: "P1", code: "P1");
        var p2 = ProductSeed.NewProduct(name: "P2", code: "P2");
        var p3 = ProductSeed.NewProduct(name: "P3", code: "P3");
        await ProductSeed.SeedAsync(_dbName, addOn, p1, p2, p3,
            ProductSeed.NewLink(p1.Id, addOn.Id),
            ProductSeed.NewLink(p2.Id, addOn.Id),
            ProductSeed.NewLink(p3.Id, addOn.Id, isActive: false));

        var result = await Handler().Handle(new GetProductsQuery { IsAddOn = true }, CancellationToken.None);

        var dto = result.ShouldHaveSingleItem();
        dto.Name.ShouldBe("Shot");
        dto.AddOnCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_IsAddOnFalse_ReturnsProductsWithActiveAddOnCount()
    {
        var addOn1 = ProductSeed.NewProduct(name: "Shot", code: "S1", isAddOn: true);
        var addOn2 = ProductSeed.NewProduct(name: "Syrup", code: "S2", isAddOn: true);
        var parent = ProductSeed.NewProduct(name: "Latte", code: "L");
        await ProductSeed.SeedAsync(_dbName, addOn1, addOn2, parent,
            ProductSeed.NewLink(parent.Id, addOn1.Id),
            ProductSeed.NewLink(parent.Id, addOn2.Id, isActive: false));

        var result = await Handler().Handle(new GetProductsQuery { IsAddOn = false }, CancellationToken.None);

        var dto = result.ShouldHaveSingleItem();
        dto.Name.ShouldBe("Latte");
        dto.AddOnCount.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_IsAddOnUnspecified_CountsPerKindOfProduct()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var parent = ProductSeed.NewProduct(name: "Latte", code: "L");
        await ProductSeed.SeedAsync(_dbName, addOn, parent, ProductSeed.NewLink(parent.Id, addOn.Id));

        var result = await Handler().Handle(new GetProductsQuery { IsAddOn = null }, CancellationToken.None);

        result.Single(p => p.Name == "Latte").AddOnCount.ShouldBe(1);
        result.Single(p => p.Name == "Shot").AddOnCount.ShouldBe(1);
    }

    [Fact]
    public async Task Handle_ProductWithImage_ReturnsImageUrl()
    {
        var product = ProductSeed.NewProduct();
        var productImage = ProductSeed.NewImage(product.Id, "https://cdn.example/a.png", out var image);
        await ProductSeed.SeedAsync(_dbName, product, image, productImage);

        var result = await Handler().Handle(new GetProductsQuery(), CancellationToken.None);

        result.ShouldHaveSingleItem().ImageUrl.ShouldBe("https://cdn.example/a.png");
    }

    [Fact]
    public async Task Handle_ProductWithoutImage_ReturnsNullImageUrl()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewProduct());

        var result = await Handler().Handle(new GetProductsQuery(), CancellationToken.None);

        result.ShouldHaveSingleItem().ImageUrl.ShouldBeNull();
    }

    // SQL Server collation and translation of the search: see Database/ProductDatabaseTests.cs.
}
