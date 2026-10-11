using WTF.Api.Features.Products;
using WTF.Api.Features.Products.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetProductAddOnsHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetProductAddOnsHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsEmptyList()
    {
        var result = await Handler().Handle(new GetProductAddOnsQuery(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_AddOnsOfSeveralTypes_AreGroupedByTypeInEnumOrder()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var large = ProductSeed.NewProduct(name: "Large", code: "L", isAddOn: true);
        var xl = ProductSeed.NewProduct(name: "XL", code: "XL", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, large, xl,
            ProductSeed.NewLink(product.Id, shot.Id, (int)AddOnTypeEnum.Extra),
            ProductSeed.NewLink(product.Id, large.Id, (int)AddOnTypeEnum.Size),
            ProductSeed.NewLink(product.Id, xl.Id, (int)AddOnTypeEnum.Size));

        var result = await Handler().Handle(new GetProductAddOnsQuery(product.Id), CancellationToken.None);

        result.Select(g => g.Type).ShouldBe([AddOnTypeEnum.Size, AddOnTypeEnum.Extra]);
        result[0].DisplayName.ShouldBe("Size");
        result[0].Options.Select(o => o.Name).Order().ShouldBe(["Large", "XL"]);
        result[1].Options.Select(o => o.Name).ShouldBe(["Shot"]);
    }

    [Fact]
    public async Task Handle_LinkWithoutType_DefaultsToExtra()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id, typeId: null));

        var result = await Handler().Handle(new GetProductAddOnsQuery(product.Id), CancellationToken.None);

        result.ShouldHaveSingleItem().Type.ShouldBe(AddOnTypeEnum.Extra);
    }

    [Fact]
    public async Task Handle_InactiveLinkOrInactiveAddOn_AreExcluded()
    {
        var product = ProductSeed.NewProduct();
        var inactiveLink = ProductSeed.NewProduct(name: "OldLink", code: "OL", isAddOn: true);
        var inactiveAddOn = ProductSeed.NewProduct(name: "Retired", code: "RT", isAddOn: true, isActive: false);
        var good = ProductSeed.NewProduct(name: "Good", code: "G", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, inactiveLink, inactiveAddOn, good,
            ProductSeed.NewLink(product.Id, inactiveLink.Id, isActive: false),
            ProductSeed.NewLink(product.Id, inactiveAddOn.Id),
            ProductSeed.NewLink(product.Id, good.Id));

        var result = await Handler().Handle(new GetProductAddOnsQuery(product.Id), CancellationToken.None);

        result.SelectMany(g => g.Options).Select(o => o.Name).ShouldBe(["Good"]);
    }

    [Fact]
    public async Task Handle_ActiveOverride_ReplacesEffectivePrice_InactiveOverrideIsIgnored()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", price: 20m, isAddOn: true);
        var syrup = ProductSeed.NewProduct(name: "Syrup", code: "SY", price: 15m, isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, syrup,
            ProductSeed.NewLink(product.Id, shot.Id), ProductSeed.NewLink(product.Id, syrup.Id),
            ProductSeed.NewOverride(product.Id, shot.Id, 5m),
            ProductSeed.NewOverride(product.Id, syrup.Id, 1m, isActive: false));

        var result = await Handler().Handle(new GetProductAddOnsQuery(product.Id), CancellationToken.None);

        var options = result.SelectMany(g => g.Options).ToList();
        options.Single(o => o.Name == "Shot").OverridePrice.ShouldBe(5m);
        options.Single(o => o.Name == "Shot").EffectivePrice.ShouldBe(5m);
        options.Single(o => o.Name == "Syrup").OverridePrice.ShouldBeNull();
        options.Single(o => o.Name == "Syrup").EffectivePrice.ShouldBe(15m);
    }

    [Fact]
    public async Task Handle_NegativeOverride_IsReturnedAsIs()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Small", code: "SM", price: 20m, isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id),
            ProductSeed.NewOverride(product.Id, shot.Id, -10m));

        var result = await Handler().Handle(new GetProductAddOnsQuery(product.Id), CancellationToken.None);

        result.Single().Options.Single().EffectivePrice.ShouldBe(-10m);
    }

    [Fact]
    public async Task Handle_AddOnWithImage_ReturnsImageUrl()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var productImage = ProductSeed.NewImage(shot.Id, "https://cdn.example/shot.png", out var image);
        await ProductSeed.SeedAsync(_dbName, product, shot, image, productImage, ProductSeed.NewLink(product.Id, shot.Id));

        var result = await Handler().Handle(new GetProductAddOnsQuery(product.Id), CancellationToken.None);

        result.Single().Options.Single().ImageUrl.ShouldBe("https://cdn.example/shot.png");
    }
}
