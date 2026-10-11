using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Users;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class RemoveUserImageHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task Seed(bool withImage)
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 2, Name = "Cashier" });
        db.Users.Add(new User
        {
            Id = _userId, Username = "acruz", FirstName = "Ana", LastName = "Cruz", PasswordHash = "h",
            IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow
        });
        // An unrelated image that must survive.
        var keepId = Guid.NewGuid();
        db.Images.Add(new Image { ImageId = keepId, ImageUrl = "/images/other.png", UploadedAt = DateTime.UtcNow });
        if (withImage)
        {
            var imageId = Guid.NewGuid();
            db.Images.Add(new Image { ImageId = imageId, ImageUrl = "/images/users/a.png", UploadedAt = DateTime.UtcNow });
            db.UserImages.Add(new UserImage { UserId = _userId, ImageId = imageId });
        }
        await db.SaveChangesAsync();
    }

    private RemoveUserImageHandler Handler() => new(TestDb.Create(_dbName), _storage);

    [Fact]
    public async Task Handle_UserWithImage_DeletesFileAndRows()
    {
        await Seed(withImage: true);

        var dto = await Handler().Handle(new RemoveUserImageCommand(_userId), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.ImageUrl.ShouldBeNull();
        await _storage.Received(1).DeleteAsync("/images/users/a.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.UserImages.CountAsync()).ShouldBe(0);
        (await db.Images.SingleAsync()).ImageUrl.ShouldBe("/images/other.png");
    }

    [Fact]
    public async Task Handle_UserWithoutImage_ReturnsDtoAndDeletesNothing()
    {
        await Seed(withImage: false);

        var dto = await Handler().Handle(new RemoveUserImageCommand(_userId), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Username.ShouldBe("acruz");
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsNull()
    {
        await Seed(withImage: true);

        var dto = await Handler().Handle(new RemoveUserImageCommand(Guid.NewGuid()), CancellationToken.None);

        dto.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
        await using var db = TestDb.Create(_dbName);
        (await db.UserImages.CountAsync()).ShouldBe(1);
    }
}
