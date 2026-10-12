using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Users;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class UploadUserImageHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();
    private readonly Guid _userId = Guid.NewGuid();
    private static readonly byte[] Bytes = TestImages.Png();

    public UploadUserImageHandlerTests()
    {
        _storage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<CancellationToken>())
            .Returns("/images/users/new.png");
    }

    private async Task Seed(string username = "Ana-Cruz Jr", string? existingImageUrl = null)
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 2, Name = "Cashier" });
        db.Users.Add(new User
        {
            Id = _userId, Username = username, FirstName = "Ana", LastName = "Cruz", PasswordHash = "h",
            IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow
        });
        if (existingImageUrl != null)
        {
            var imageId = Guid.NewGuid();
            db.Images.Add(new Image { ImageId = imageId, ImageUrl = existingImageUrl, UploadedAt = DateTime.UtcNow });
            db.UserImages.Add(new UserImage { UserId = _userId, ImageId = imageId });
        }
        await db.SaveChangesAsync();
    }

    private UploadUserImageHandler Handler()
    {
        var accessor = TestRequest.As(Guid.NewGuid());
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("api.test");
        return new UploadUserImageHandler(TestDb.Create(_dbName), _storage, accessor);
    }

    [Fact]
    public async Task Handle_ValidImage_SavesToStorageAndLinksToUser()
    {
        await Seed();

        var dto = await Handler().Handle(new UploadUserImageCommand(_userId, Bytes, "photo.PNG"), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.ImageUrl.ShouldBe("https://api.test/images/users/new.png");
        await _storage.Received(1).SaveAsync(
            "users",
            Arg.Is<string>(f => f.StartsWith("ana_cruz_jr_") && f.EndsWith(".png")),
            Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        var link = await db.UserImages.Include(ui => ui.Image).SingleAsync();
        link.UserId.ShouldBe(_userId);
        link.Image.ImageUrl.ShouldBe("/images/users/new.png");
    }

    [Fact]
    public async Task Handle_UserAlreadyHasImage_ReplacesItAndDeletesOldFile()
    {
        await Seed(existingImageUrl: "/images/users/old.png");

        var dto = await Handler().Handle(new UploadUserImageCommand(_userId, Bytes, "photo.jpg"), CancellationToken.None);

        dto.ShouldNotBeNull();
        await _storage.Received(1).DeleteAsync("/images/users/old.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.UserImages.CountAsync()).ShouldBe(1);
        (await db.Images.SingleAsync()).ImageUrl.ShouldBe("/images/users/new.png");
    }

    [Theory]
    [InlineData("a.gif")]
    [InlineData("a.exe")]
    [InlineData("noextension")]
    public async Task Upload_FileNameIsIgnored_TheRealTypeNamesTheStoredFile(string fileName)
    {
        await Seed();

        var result = await Handler().Handle(new UploadUserImageCommand(_userId, Bytes, fileName), CancellationToken.None);

        result.ShouldNotBeNull();
        await _storage.Received(1).SaveAsync("users", Arg.Is<string>(n => n.EndsWith(".png")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Upload_AScriptNamedLikeAPicture_IsRefusedWithAMessage_AndStoresNothing()
    {
        await Seed();

        var error = await Should.ThrowAsync<ImageRejectedException>(() =>
            Handler().Handle(new UploadUserImageCommand(_userId, TestImages.Script(), "a.png"), CancellationToken.None));

        error.Message.ShouldBe(ImageSanitizer.NotAnImageMessage);
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_EmptyData_IsRefused()
    {
        await Seed();

        await Should.ThrowAsync<ImageRejectedException>(() =>
            Handler().Handle(new UploadUserImageCommand(_userId, [], "a.png"), CancellationToken.None));
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_OverFiveMegabytes_IsRefusedAsTooBig()
    {
        await Seed();

        var error = await Should.ThrowAsync<ImageRejectedException>(() =>
            Handler().Handle(new UploadUserImageCommand(_userId, TestImages.OverTheLimit(), "a.png"), CancellationToken.None));

        error.Message.ShouldContain("too big");
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Upload_AJpegAndAWebpKeepTheirOwnType_AndAPngKeepsItsTransparency()
    {
        await Seed();

        await Handler().Handle(new UploadUserImageCommand(_userId, TestImages.Jpeg(), "x.png"), CancellationToken.None);
        await Handler().Handle(new UploadUserImageCommand(_userId, TestImages.Webp(), "x.jpg"), CancellationToken.None);
        await Handler().Handle(new UploadUserImageCommand(_userId, TestImages.Png(8, 8, SkiaSharp.SKColors.Transparent), "x.webp"), CancellationToken.None);

        await _storage.Received(1).SaveAsync("users", Arg.Is<string>(n => n.EndsWith(".jpg")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await _storage.Received(1).SaveAsync("users", Arg.Is<string>(n => n.EndsWith(".webp")), Arg.Any<byte[]>(), Arg.Any<CancellationToken>());
        await _storage.Received(1).SaveAsync(
            "users",
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
    public async Task Handle_UnknownUser_ReturnsNullWithoutTouchingStorage()
    {
        await Seed();

        var dto = await Handler().Handle(new UploadUserImageCommand(Guid.NewGuid(), Bytes, "a.png"), CancellationToken.None);

        dto.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }
}
