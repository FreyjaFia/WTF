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

    private static readonly byte[] Data = TestImages.Png();

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
    public async Task Upload_FileNameIsIgnored_TheRealTypeNamesTheStoredFile(string fileName)
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, Data, fileName), CancellationToken.None);

        result.ShouldNotBeNull();
        await _storage.Received(1).SaveAsync("products", Arg.Is<string>(n => n.EndsWith(".png")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Upload_AScriptNamedLikeAPicture_IsRefusedWithAMessage_AndStoresNothing()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var error = await Should.ThrowAsync<ImageRejectedException>(() =>
            Handler().Handle(new UploadProductImageCommand(product.Id, TestImages.Script(), "a.png"), CancellationToken.None));

        error.Message.ShouldBe(ImageSanitizer.NotAnImageMessage);
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_EmptyData_IsRefused()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        await Should.ThrowAsync<ImageRejectedException>(() =>
            Handler().Handle(new UploadProductImageCommand(product.Id, [], "a.png"), CancellationToken.None));
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_OverFiveMegabytes_IsRefusedAsTooBig()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var error = await Should.ThrowAsync<ImageRejectedException>(() =>
            Handler().Handle(new UploadProductImageCommand(product.Id, TestImages.OverTheLimit(), "a.png"), CancellationToken.None));

        error.Message.ShouldContain("too big");
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_AJpegAndAWebpKeepTheirOwnType_AndAPngKeepsItsTransparency()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        await Handler().Handle(new UploadProductImageCommand(product.Id, TestImages.Jpeg(), "x.png"), CancellationToken.None);
        await Handler().Handle(new UploadProductImageCommand(product.Id, TestImages.Webp(), "x.jpg"), CancellationToken.None);
        await Handler().Handle(new UploadProductImageCommand(product.Id, TestImages.Png(8, 8, SkiaSharp.SKColors.Transparent), "x.webp"), CancellationToken.None);

        await _storage.Received(1).SaveAsync("products", Arg.Is<string>(n => n.EndsWith(".jpg")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await _storage.Received(1).SaveAsync("products", Arg.Is<string>(n => n.EndsWith(".webp")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await _storage.Received(1).SaveAsync(
            "products",
            Arg.Is<string>(n => n.EndsWith(".png")),
            Arg.Is<byte[]>(d => TestImages.FormatOf(d) == SkiaSharp.SKEncodedImageFormat.Png && HasTransparentCorner(d)),
            Arg.Any<CancellationToken>());
    }

    private static bool HasTransparentCorner(byte[] png)
    {
        using var bitmap = SkiaSharp.SKBitmap.Decode(png);
        return bitmap.GetPixel(0, 0).Alpha == 0;
    }

    [Fact]
    public async Task Handle_ValidImage_SavesFileAndLinksImageRows()
    {
        var product = ProductSeed.NewProduct(name: "Iced-Latte Large");
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new UploadProductImageCommand(product.Id, TestImages.Jpeg(), "Photo.JPG"), CancellationToken.None);

        result.ShouldNotBeNull();
        result.ImageUrl.ShouldBe("/images/products/new.png");
        await _storage.Received(1).SaveAsync(
            "products",
            Arg.Is<string>(n => n.StartsWith("iced_latte_large_") && n.EndsWith(".jpg")),
            Arg.Any<byte[]>(),
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
