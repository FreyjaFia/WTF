using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Promotions;

public class PromotionImageHandlersTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();
    private readonly byte[] _png = TestImages.Png();

    public PromotionImageHandlersTests()
    {
        _storage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<CancellationToken>())
            .Returns(ci => Task.FromResult($"/uploads/{ci.ArgAt<string>(0)}/{ci.ArgAt<string>(1)}"));
    }

    private UploadPromotionImageHandler Upload() => new(TestDb.Create(_dbName), _storage, TestRequest.As(_userId));
    private RemovePromotionImageHandler Remove() => new(TestDb.Create(_dbName), _storage, TestRequest.As(_userId));

    private async Task<Guid> SeedPromotionAsync(string name = "Summer Sale-Deal", string? existingImageUrl = null)
    {
        await using var db = TestDb.Create(_dbName);
        var promo = PromotionSeed.NewPromotion(PromotionTypeIds.MixMatch, name);
        db.Promotions.Add(promo);
        if (existingImageUrl is not null)
        {
            var image = new Image { ImageId = Guid.NewGuid(), ImageUrl = existingImageUrl, UploadedAt = PromotionSeed.Now };
            db.Images.Add(image);
            db.PromotionImages.Add(new PromotionImage { PromotionId = promo.Id, ImageId = image.ImageId });
        }
        await db.SaveChangesAsync();
        return promo.Id;
    }

    [Fact]
    public async Task Upload_ValidImage_StoresFileAndLinksImage()
    {
        var id = await SeedPromotionAsync();

        var dto = await Upload().Handle(new UploadPromotionImageCommand(id, _png, "banner.PNG"), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.PromotionId.ShouldBe(id);
        dto.ImageUrl.ShouldNotBeNull().ShouldContain("/uploads/promotions/summer_sale_deal_");
        dto.ImageUrl.ShouldEndWith(".png");
        await _storage.Received(1).SaveAsync("promotions", Arg.Is<string>(n => n.StartsWith("summer_sale_deal_") && n.EndsWith(".png")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(1);
        (await db.PromotionImages.SingleAsync()).PromotionId.ShouldBe(id);
        var promo = await db.Promotions.SingleAsync();
        promo.UpdatedBy.ShouldBe(_userId);
        promo.UpdatedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task Upload_ReplacingExistingImage_DeletesOldFileAndRow()
    {
        var id = await SeedPromotionAsync(existingImageUrl: "/uploads/promotions/old.jpg");

        await Upload().Handle(new UploadPromotionImageCommand(id, _png, "new.jpg"), CancellationToken.None);

        await _storage.Received(1).DeleteAsync("/uploads/promotions/old.jpg", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(1);
        (await db.Images.SingleAsync()).ImageUrl.ShouldNotBe("/uploads/promotions/old.jpg");
        (await db.PromotionImages.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Upload_UnknownPromotion_ReturnsNullAndStoresNothing()
    {
        var dto = await Upload().Handle(new UploadPromotionImageCommand(Guid.NewGuid(), _png, "a.png"), CancellationToken.None);

        dto.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Theory]
    [InlineData("a.gif")]
    [InlineData("a.exe")]
    [InlineData("noextension")]
    public async Task Upload_FileNameIsIgnored_TheRealTypeNamesTheStoredFile(string fileName)
    {
        var id = await SeedPromotionAsync();

        var result = await Upload().Handle(new UploadPromotionImageCommand(id, _png, fileName), CancellationToken.None);

        result.ShouldNotBeNull();
        await _storage.Received(1).SaveAsync("promotions", Arg.Is<string>(n => n.EndsWith(".png")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Upload_AScriptNamedLikeAPicture_IsRefusedWithAMessage_AndStoresNothing()
    {
        var id = await SeedPromotionAsync();

        var error = await Should.ThrowAsync<ImageRejectedException>(() =>
            Upload().Handle(new UploadPromotionImageCommand(id, TestImages.Script(), "a.png"), CancellationToken.None));

        error.Message.ShouldBe(ImageSanitizer.NotAnImageMessage);
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_EmptyData_IsRefused()
    {
        var id = await SeedPromotionAsync();

        await Should.ThrowAsync<ImageRejectedException>(() =>
            Upload().Handle(new UploadPromotionImageCommand(id, [], "a.png"), CancellationToken.None));
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_OverFiveMegabytes_IsRefusedAsTooBig()
    {
        var id = await SeedPromotionAsync();

        var error = await Should.ThrowAsync<ImageRejectedException>(() =>
            Upload().Handle(new UploadPromotionImageCommand(id, TestImages.OverTheLimit(), "a.png"), CancellationToken.None));

        error.Message.ShouldContain("too big");
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_AJpegAndAWebpKeepTheirOwnType_AndAPngKeepsItsTransparency()
    {
        var id = await SeedPromotionAsync();

        await Upload().Handle(new UploadPromotionImageCommand(id, TestImages.Jpeg(), "x.png"), CancellationToken.None);
        await Upload().Handle(new UploadPromotionImageCommand(id, TestImages.Webp(), "x.jpg"), CancellationToken.None);
        await Upload().Handle(new UploadPromotionImageCommand(id, TestImages.Png(8, 8, SkiaSharp.SKColors.Transparent), "x.webp"), CancellationToken.None);

        await _storage.Received(1).SaveAsync("promotions", Arg.Is<string>(n => n.EndsWith(".jpg")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await _storage.Received(1).SaveAsync("promotions", Arg.Is<string>(n => n.EndsWith(".webp")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await _storage.Received(1).SaveAsync(
            "promotions",
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
    public async Task Remove_PromotionWithImage_DeletesFileAndRows()
    {
        var id = await SeedPromotionAsync(existingImageUrl: "/uploads/promotions/old.jpg");

        var dto = await Remove().Handle(new RemovePromotionImageCommand(id), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.ImageUrl.ShouldBeNull();
        await _storage.Received(1).DeleteAsync("/uploads/promotions/old.jpg", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(0);
        (await db.PromotionImages.CountAsync()).ShouldBe(0);
        (await db.Promotions.SingleAsync()).UpdatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Remove_PromotionWithoutImage_IsNoOp()
    {
        var id = await SeedPromotionAsync();

        var dto = await Remove().Handle(new RemovePromotionImageCommand(id), CancellationToken.None);

        dto.ShouldNotBeNull();
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
        await using var db = TestDb.Create(_dbName);
        (await db.Promotions.SingleAsync()).UpdatedAt.ShouldBeNull();
    }

    [Fact]
    public async Task Remove_UnknownPromotion_ReturnsNull()
    {
        (await Remove().Handle(new RemovePromotionImageCommand(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }
}
