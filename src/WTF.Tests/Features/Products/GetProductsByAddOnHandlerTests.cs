using WTF.Api.Features.Products;
using WTF.Api.Features.Products.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetProductsByAddOnHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetProductsByAddOnHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    [Fact]
    public async Task Handle_UnknownAddOn_ReturnsEmptyList()
    {
        var result = await Handler().Handle(new GetProductsByAddOnQuery(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_IdBelongsToRegularProduct_ReturnsEmptyList()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new GetProductsByAddOnQuery(product.Id), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_LinkedProducts_AreGroupedByLinkTypeInEnumOrder()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var p1 = ProductSeed.NewProduct(name: "P1", code: "P1");
        var p2 = ProductSeed.NewProduct(name: "P2", code: "P2");
        var p3 = ProductSeed.NewProduct(name: "P3", code: "P3");
        await ProductSeed.SeedAsync(_dbName, addOn, p1, p2, p3,
            ProductSeed.NewLink(p1.Id, addOn.Id, (int)AddOnTypeEnum.Sauce),
            ProductSeed.NewLink(p2.Id, addOn.Id, (int)AddOnTypeEnum.Size),
            ProductSeed.NewLink(p3.Id, addOn.Id, (int)AddOnTypeEnum.Size));

        var result = await Handler().Handle(new GetProductsByAddOnQuery(addOn.Id), CancellationToken.None);

        result.Select(g => g.Type).ShouldBe([AddOnTypeEnum.Size, AddOnTypeEnum.Sauce]);
        result[0].Options.Select(o => o.Name).Order().ShouldBe(["P2", "P3"]);
        result[1].Options.Select(o => o.Name).ShouldBe(["P1"]);
    }

    [Fact]
    public async Task Handle_LinkWithoutType_DefaultsToExtra()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var p1 = ProductSeed.NewProduct(name: "P1", code: "P1");
        await ProductSeed.SeedAsync(_dbName, addOn, p1, ProductSeed.NewLink(p1.Id, addOn.Id, typeId: null));

        var result = await Handler().Handle(new GetProductsByAddOnQuery(addOn.Id), CancellationToken.None);

        result.ShouldHaveSingleItem().Type.ShouldBe(AddOnTypeEnum.Extra);
    }

    [Fact]
    public async Task Handle_InactiveLinkOrInactiveProduct_AreExcluded()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var inactiveLink = ProductSeed.NewProduct(name: "OldLink", code: "OL");
        var inactiveProduct = ProductSeed.NewProduct(name: "Retired", code: "RT", isActive: false);
        var good = ProductSeed.NewProduct(name: "Good", code: "G");
        await ProductSeed.SeedAsync(_dbName, addOn, inactiveLink, inactiveProduct, good,
            ProductSeed.NewLink(inactiveLink.Id, addOn.Id, isActive: false),
            ProductSeed.NewLink(inactiveProduct.Id, addOn.Id),
            ProductSeed.NewLink(good.Id, addOn.Id));

        var result = await Handler().Handle(new GetProductsByAddOnQuery(addOn.Id), CancellationToken.None);

        result.SelectMany(g => g.Options).Select(o => o.Name).ShouldBe(["Good"]);
    }

    [Fact]
    public async Task Handle_ProductWithImage_ReturnsImageUrl()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var product = ProductSeed.NewProduct();
        var productImage = ProductSeed.NewImage(product.Id, "https://cdn.example/p.png", out var image);
        await ProductSeed.SeedAsync(_dbName, addOn, product, image, productImage, ProductSeed.NewLink(product.Id, addOn.Id));

        var result = await Handler().Handle(new GetProductsByAddOnQuery(addOn.Id), CancellationToken.None);

        result.Single().Options.Single().ImageUrl.ShouldBe("https://cdn.example/p.png");
    }
}
