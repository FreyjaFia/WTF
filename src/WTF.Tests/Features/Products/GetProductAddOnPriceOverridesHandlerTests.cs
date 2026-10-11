using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class GetProductAddOnPriceOverridesHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetProductAddOnPriceOverridesHandler Handler() => new(TestDb.Create(_dbName));

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsEmptyList()
    {
        var result = await Handler().Handle(new GetProductAddOnPriceOverridesQuery(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_ReturnsOverridesOfActiveLinksIncludingNegativeAndInactiveOverrides()
    {
        var product = ProductSeed.NewProduct();
        var a1 = ProductSeed.NewProduct(name: "A1", code: "A1", isAddOn: true);
        var a2 = ProductSeed.NewProduct(name: "A2", code: "A2", isAddOn: true);
        var a3 = ProductSeed.NewProduct(name: "A3", code: "A3", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, a1, a2, a3,
            ProductSeed.NewLink(product.Id, a1.Id), ProductSeed.NewLink(product.Id, a2.Id),
            ProductSeed.NewLink(product.Id, a3.Id, isActive: false),
            ProductSeed.NewOverride(product.Id, a1.Id, -4m),
            ProductSeed.NewOverride(product.Id, a2.Id, 6m, isActive: false),
            ProductSeed.NewOverride(product.Id, a3.Id, 9m));

        var result = await Handler().Handle(new GetProductAddOnPriceOverridesQuery(product.Id), CancellationToken.None);

        result.Count.ShouldBe(2);
        result.Single(o => o.AddOnId == a1.Id).Price.ShouldBe(-4m);
        result.Single(o => o.AddOnId == a2.Id).IsActive.ShouldBeFalse();
        result.ShouldNotContain(o => o.AddOnId == a3.Id);
    }

    [Fact]
    public async Task Handle_OtherProductsOverrides_AreExcluded()
    {
        var product = ProductSeed.NewProduct();
        var other = ProductSeed.NewProduct(name: "Other", code: "O");
        var addOn = ProductSeed.NewProduct(name: "A", code: "A", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, other, addOn,
            ProductSeed.NewLink(product.Id, addOn.Id), ProductSeed.NewLink(other.Id, addOn.Id),
            ProductSeed.NewOverride(other.Id, addOn.Id, 3m));

        var result = await Handler().Handle(new GetProductAddOnPriceOverridesQuery(product.Id), CancellationToken.None);

        result.ShouldBeEmpty();
    }
}
