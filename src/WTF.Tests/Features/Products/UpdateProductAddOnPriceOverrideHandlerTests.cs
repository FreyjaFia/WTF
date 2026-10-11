using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class UpdateProductAddOnPriceOverrideHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _productId = Guid.NewGuid();
    private readonly Guid _addOnId = Guid.NewGuid();

    private UpdateProductAddOnPriceOverrideHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    private UpdateProductAddOnPriceOverrideCommand Command(decimal price, bool isActive = true) =>
        new() { ProductId = _productId, AddOnId = _addOnId, Price = price, IsActive = isActive };

    [Fact]
    public async Task Handle_NoActiveLink_ReturnsNull()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId, isActive: false),
            ProductSeed.NewOverride(_productId, _addOnId, 4m));

        var result = await Handler().Handle(Command(8m), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_NoOverride_ReturnsNull()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId));

        var result = await Handler().Handle(Command(8m), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_ExistingOverride_UpdatesPriceAndStampsUser()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId),
            ProductSeed.NewOverride(_productId, _addOnId, 4m));

        var result = await Handler().Handle(Command(8m), CancellationToken.None);

        result.ShouldNotBeNull();
        result.Price.ShouldBe(8m);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.ProductAddOnPriceOverrides.SingleAsync();
        saved.Price.ShouldBe(8m);
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task Handle_NegativePrice_IsAllowed()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId),
            ProductSeed.NewOverride(_productId, _addOnId, 4m));

        var result = await Handler().Handle(Command(-2m), CancellationToken.None);

        result!.Price.ShouldBe(-2m);
    }

    [Fact]
    public async Task Handle_CanDeactivateOverride()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId),
            ProductSeed.NewOverride(_productId, _addOnId, 4m));

        var result = await Handler().Handle(Command(4m, isActive: false), CancellationToken.None);

        result!.IsActive.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOnPriceOverrides.SingleAsync()).IsActive.ShouldBeFalse();
    }
}
