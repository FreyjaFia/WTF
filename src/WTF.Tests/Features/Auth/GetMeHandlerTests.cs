using Microsoft.AspNetCore.Http;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Auth;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class GetMeHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task Seed(string? imageUrl)
    {
        await using var db = TestDb.Create(_dbName);
        db.Users.Add(new User
        {
            Id = _userId,
            Username = "alem",
            FirstName = "Al",
            LastName = "Em",
            PasswordHash = "hash",
            IsActive = true,
            RoleId = 1,
            CreatedAt = DateTime.UtcNow
        });
        if (imageUrl != null)
        {
            var imageId = Guid.NewGuid();
            db.Images.Add(new Image { ImageId = imageId, ImageUrl = imageUrl, UploadedAt = DateTime.UtcNow });
            db.UserImages.Add(new UserImage { UserId = _userId, ImageId = imageId });
        }
        await db.SaveChangesAsync();
    }

    private GetMeHandler Handler(Guid? asUser = null)
    {
        var accessor = TestRequest.As(asUser ?? _userId, AppRoles.Cashier);
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("api.test");
        return new GetMeHandler(TestDb.Create(_dbName), accessor);
    }

    [Fact]
    public async Task Handle_UserWithoutImage_ReturnsNamesAndNullImage()
    {
        await Seed(null);

        var me = await Handler().Handle(new GetMeQuery(), CancellationToken.None);

        me.ShouldNotBeNull();
        me.FirstName.ShouldBe("Al");
        me.LastName.ShouldBe("Em");
        me.ImageUrl.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_RelativeImageUrl_IsMadeAbsolute()
    {
        await Seed("/images/users/a.png");

        var me = await Handler().Handle(new GetMeQuery(), CancellationToken.None);

        me!.ImageUrl.ShouldBe("https://api.test/images/users/a.png");
    }

    [Fact]
    public async Task Handle_AbsoluteImageUrl_IsReturnedUnchanged()
    {
        await Seed("https://cdn.example.com/a.png");

        var me = await Handler().Handle(new GetMeQuery(), CancellationToken.None);

        me!.ImageUrl.ShouldBe("https://cdn.example.com/a.png");
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsNull()
    {
        await Seed(null);

        var me = await Handler(Guid.NewGuid()).Handle(new GetMeQuery(), CancellationToken.None);

        me.ShouldBeNull();
    }

    [Fact]
    public void MeDto_ExposesOnlyNameAndImage()
    {
        typeof(WTF.Api.Features.Auth.DTOs.MeDto).GetProperties().Select(p => p.Name)
            .ShouldBe(["FirstName", "LastName", "ImageUrl"], ignoreOrder: true);
    }
}
