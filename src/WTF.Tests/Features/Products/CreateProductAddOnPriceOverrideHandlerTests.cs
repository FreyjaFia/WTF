using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class CreateProductAddOnPriceOverrideHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _productId = Guid.NewGuid();
    private readonly Guid _addOnId = Guid.NewGuid();

    private CreateProductAddOnPriceOverrideHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId));

    private CreateProductAddOnPriceOverrideCommand Command(decimal price = 5m, bool isActive = true) =>
        new() { ProductId = _productId, AddOnId = _addOnId, Price = price, IsActive = isActive };

    [Fact]
    public async Task Handle_NoActiveLink_ReturnsNullAndCreatesNothing()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId, isActive: false));

        var result = await Handler().Handle(Command(), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOnPriceOverrides.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_ActiveLink_CreatesOverride()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId));

        var result = await Handler().Handle(Command(7.5m), CancellationToken.None);

        result.ShouldNotBeNull();
        result.Price.ShouldBe(7.5m);
        result.IsActive.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.ProductAddOnPriceOverrides.SingleAsync();
        saved.ProductId.ShouldBe(_productId);
        saved.AddOnId.ShouldBe(_addOnId);
        saved.CreatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Handle_NegativePrice_IsAllowed()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId));

        var result = await Handler().Handle(Command(-3m), CancellationToken.None);

        result.ShouldNotBeNull();
        result.Price.ShouldBe(-3m);
    }

    [Fact]
    public async Task Handle_ActiveOverrideAlreadyExists_ReturnsNullAndKeepsPrice()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId),
            ProductSeed.NewOverride(_productId, _addOnId, 4m));

        var result = await Handler().Handle(Command(9m), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOnPriceOverrides.SingleAsync()).Price.ShouldBe(4m);
    }

    [Fact]
    public async Task Handle_SoftDeletedOverrideExists_ReusesRowInsteadOfDuplicating()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewLink(_productId, _addOnId),
            ProductSeed.NewOverride(_productId, _addOnId, 4m, isActive: false));

        var result = await Handler().Handle(Command(9m), CancellationToken.None);

        result.ShouldNotBeNull();
        result.Price.ShouldBe(9m);
        result.IsActive.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.ProductAddOnPriceOverrides.SingleAsync();
        saved.Price.ShouldBe(9m);
        saved.IsActive.ShouldBeTrue();
        saved.UpdatedBy.ShouldBe(_userId);
    }

    // Unique index and foreign key on the override: see Database/ProductDatabaseTests.cs.
}
