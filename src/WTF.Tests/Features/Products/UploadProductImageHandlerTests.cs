using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Products;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class UploadProductImageHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();

    public UploadProductImageHandlerTests()
    {
        _storage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<CancellationToken>())
            .Returns("/images/products/new.png");
    }

    private UploadProductImageHandler Handler() => new(TestDb.Create(_dbName), _storage, TestRequest.None());

    private static readonly byte[] Data = [1, 2, 3];

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsNullAndStoresNothing()
    {
        var result = await Handler().Handle(new UploadProductImageCommand(Guid.NewGuid(), Data, "a.png"), CancellationToken.None);

        result.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Theory]
    [InlineData("a.gif")]
    [InlineData("a.exe")]
    [InlineData("noextension")]
    public async Task Handle_DisallowedExtension_ReturnsNullAndStoresNothing(string fileName)
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, Data, fileName), CancellationToken.None);

        result.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Handle_EmptyData_ReturnsNull()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, [], "a.png"), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_DataOverFiveMegabytes_ReturnsNull()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, new byte[5 * 1024 * 1024 + 1], "a.png"), CancellationToken.None);

        result.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Handle_DataOfExactlyFiveMegabytes_IsAccepted()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, new byte[5 * 1024 * 1024], "a.png"), CancellationToken.None);

        result.ShouldNotBeNull();
    }

    [Fact]
    public async Task Handle_ValidImage_SavesFileAndLinksImageRows()
    {
        var product = ProductSeed.NewProduct(name: "Iced-Latte Large");
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, Data, "Photo.JPG"), CancellationToken.None);

        result.ShouldNotBeNull();
        result.ImageUrl.ShouldBe("/images/products/new.png");
        await _storage.Received(1).SaveAsync(
            "products",
            Arg.Is<string>(n => n.StartsWith("iced_latte_large_") && n.EndsWith(".jpg")),
            Data,
            Arg.Any<CancellationToken>());

        await using var db = TestDb.Create(_dbName);
        var image = await db.Images.SingleAsync();
        image.ImageUrl.ShouldBe("/images/products/new.png");
        var link = await db.ProductImages.SingleAsync();
        link.ProductId.ShouldBe(product.Id);
        link.ImageId.ShouldBe(image.ImageId);
    }

    [Fact]
    public async Task Handle_ProductAlreadyHasImage_DeletesOldFileAndReplacesRows()
    {
        var product = ProductSeed.NewProduct();
        var oldLink = ProductSeed.NewImage(product.Id, "/images/products/old.png", out var oldImage);
        await ProductSeed.SeedAsync(_dbName, product, oldImage, oldLink);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, Data, "a.png"), CancellationToken.None);

        result.ShouldNotBeNull();
        await _storage.Received(1).DeleteAsync("/images/products/old.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.SingleAsync()).ImageUrl.ShouldBe("/images/products/new.png");
        (await db.ProductImages.CountAsync()).ShouldBe(1);
    }
}
