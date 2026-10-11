using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Products;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class RemoveProductImageHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();

    private RemoveProductImageHandler Handler() => new(TestDb.Create(_dbName), _storage);

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsNull()
    {
        var result = await Handler().Handle(new RemoveProductImageCommand(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_ProductWithImage_DeletesFileAndRows()
    {
        var product = ProductSeed.NewProduct();
        var link = ProductSeed.NewImage(product.Id, "/images/products/old.png", out var image);
        await ProductSeed.SeedAsync(_dbName, product, image, link);

        var result = await Handler().Handle(new RemoveProductImageCommand(product.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.ImageUrl.ShouldBeNull();
        await _storage.Received(1).DeleteAsync("/images/products/old.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(0);
        (await db.ProductImages.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_ProductWithoutImage_ReturnsProductWithoutTouchingStorage()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new RemoveProductImageCommand(product.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.Id.ShouldBe(product.Id);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }
}
