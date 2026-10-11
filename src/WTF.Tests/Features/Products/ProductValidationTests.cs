using WTF.Api.Features.Products;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class ProductValidationTests
{
    private readonly string _dbName = TestDb.NewName();

    [Fact]
    public async Task EnsureUniqueCodeAsync_NoProducts_DoesNotThrow()
    {
        await using var db = TestDb.Create(_dbName);

        await ProductValidation.EnsureUniqueCodeAsync(db, "ABC");
    }

    [Fact]
    public async Task EnsureUniqueCodeAsync_CodeInUse_Throws()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewProduct(code: "ABC"));
        await using var db = TestDb.Create(_dbName);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => ProductValidation.EnsureUniqueCodeAsync(db, "ABC"));
        ex.Message.ShouldBe("Product code already exists.");
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("  Abc ")]
    public async Task EnsureUniqueCodeAsync_CodeInUseDifferentCaseOrPadding_ThrowsBecauseCodeIsNormalized(string candidate)
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewProduct(code: "ABC"));
        await using var db = TestDb.Create(_dbName);

        await Should.ThrowAsync<InvalidOperationException>(() => ProductValidation.EnsureUniqueCodeAsync(db, candidate));
    }

    [Fact]
    public async Task EnsureUniqueCodeAsync_CodeOwnedByExcludedProduct_DoesNotThrow()
    {
        var product = ProductSeed.NewProduct(code: "ABC");
        await ProductSeed.SeedAsync(_dbName, product);
        await using var db = TestDb.Create(_dbName);

        await ProductValidation.EnsureUniqueCodeAsync(db, "abc", product.Id);
    }

    [Fact]
    public async Task EnsureUniqueCodeAsync_CodeOwnedByAnotherProductWhileExcludingTheCurrent_Throws()
    {
        var current = ProductSeed.NewProduct(code: "AAA");
        var other = ProductSeed.NewProduct(name: "Other", code: "BBB");
        await ProductSeed.SeedAsync(_dbName, current, other);
        await using var db = TestDb.Create(_dbName);

        await Should.ThrowAsync<InvalidOperationException>(() => ProductValidation.EnsureUniqueCodeAsync(db, "BBB", current.Id));
    }

    [Fact]
    public async Task EnsureUniqueCodeAsync_InactiveProductHoldsCode_Throws()
    {
        await ProductSeed.SeedAsync(_dbName, ProductSeed.NewProduct(code: "OLD", isActive: false));
        await using var db = TestDb.Create(_dbName);

        await Should.ThrowAsync<InvalidOperationException>(() => ProductValidation.EnsureUniqueCodeAsync(db, "OLD"));
    }
}
