using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class SetProductAddOnDefaultHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private SetProductAddOnDefaultHandler Handler() => new(TestDb.Create(_dbName));

    private static SetProductAddOnDefaultCommand Command(Guid productId, Guid addOnId, bool isDefault) =>
        new() { ProductId = productId, AddOnId = addOnId, IsDefault = isDefault };

    [Fact]
    public async Task Handle_UnknownLink_ReturnsFalse()
    {
        var result = await Handler().Handle(Command(Guid.NewGuid(), Guid.NewGuid(), true), CancellationToken.None);

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_InactiveLink_ReturnsFalse()
    {
        var product = ProductSeed.NewProduct();
        var small = ProductSeed.NewProduct(name: "Small", code: "SM", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, small, ProductSeed.NewLink(product.Id, small.Id, CatalogSeed.Size, isActive: false));

        var result = await Handler().Handle(Command(product.Id, small.Id, true), CancellationToken.None);

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_OptionOfRequiredType_BecomesTheOnlyDefaultOfItsType()
    {
        var product = ProductSeed.NewProduct();
        var small = ProductSeed.NewProduct(name: "Small", code: "SM", isAddOn: true);
        var large = ProductSeed.NewProduct(name: "Large", code: "LG", isAddOn: true);
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, small, large, shot,
            ProductSeed.NewLink(product.Id, small.Id, CatalogSeed.Size, isDefault: true),
            ProductSeed.NewLink(product.Id, large.Id, CatalogSeed.Size),
            ProductSeed.NewLink(product.Id, shot.Id, CatalogSeed.Extra));

        var result = await Handler().Handle(Command(product.Id, large.Id, true), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOns.SingleAsync(l => l.AddOnId == large.Id)).IsDefault.ShouldBeTrue();
        (await db.ProductAddOns.SingleAsync(l => l.AddOnId == small.Id)).IsDefault.ShouldBeFalse();
        (await db.ProductAddOns.SingleAsync(l => l.AddOnId == shot.Id)).IsDefault.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_OptionOfOptionalType_Throws()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id, CatalogSeed.Extra));

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Command(product.Id, shot.Id, true), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_ClearingTheDefault_LeavesNoDefault()
    {
        var product = ProductSeed.NewProduct();
        var small = ProductSeed.NewProduct(name: "Small", code: "SM", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, small, ProductSeed.NewLink(product.Id, small.Id, CatalogSeed.Size, isDefault: true));

        var result = await Handler().Handle(Command(product.Id, small.Id, false), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOns.SingleAsync()).IsDefault.ShouldBeFalse();
    }
}
