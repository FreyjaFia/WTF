using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class DeleteProductAddOnPriceOverrideHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _productId = Guid.NewGuid();
    private readonly Guid _addOnId = Guid.NewGuid();

    private DeleteProductAddOnPriceOverrideHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    [Fact]
    public async Task Handle_NoOverride_ReturnsFalse()
    {
        var result = await Handler().Handle(new DeleteProductAddOnPriceOverrideCommand(_productId, _addOnId), CancellationToken.None);

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ActiveOverride_SoftDeletesKeepingRow()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewOverride(_productId, _addOnId, 4m));

        var result = await Handler().Handle(new DeleteProductAddOnPriceOverrideCommand(_productId, _addOnId), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.ProductAddOnPriceOverrides.SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.Price.ShouldBe(4m);
        saved.UpdatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Handle_AlreadyInactiveOverride_ReturnsTrueWithoutChangingIt()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewOverride(_productId, _addOnId, 4m, isActive: false));

        var result = await Handler().Handle(new DeleteProductAddOnPriceOverrideCommand(_productId, _addOnId), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOnPriceOverrides.SingleAsync()).UpdatedBy.ShouldBeNull();
    }
}
