using Microsoft.AspNetCore.Http;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class GetUserByIdHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task Seed(string? imageUrl = null, bool active = true)
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 2, Name = "Cashier" });
        db.Users.Add(new User
        {
            Id = _userId,
            Username = "acruz",
            FirstName = "Ana",
            LastName = "Cruz",
            PasswordHash = "secret-hash",
            IsActive = active,
            RoleId = 2,
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

    private GetUserByIdHandler Handler()
    {
        var accessor = TestRequest.As(Guid.NewGuid());
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("api.test");
        return new GetUserByIdHandler(TestDb.Create(_dbName), accessor);
    }

    [Fact]
    public async Task Handle_ExistingUser_ReturnsMappedDto()
    {
        await Seed();

        var dto = await Handler().Handle(new GetUserByIdQuery(_userId), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Id.ShouldBe(_userId);
        dto.Username.ShouldBe("acruz");
        dto.FirstName.ShouldBe("Ana");
        dto.RoleId.ShouldBe(UserRoleEnum.Cashier);
        dto.IsActive.ShouldBeTrue();
        dto.ImageUrl.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_InactiveUser_IsStillReturned()
    {
        await Seed(active: false);

        var dto = await Handler().Handle(new GetUserByIdQuery(_userId), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_RelativeImage_IsMadeAbsolute()
    {
        await Seed("/images/users/a.png");

        var dto = await Handler().Handle(new GetUserByIdQuery(_userId), CancellationToken.None);

        dto!.ImageUrl.ShouldBe("https://api.test/images/users/a.png");
    }

    [Fact]
    public async Task Handle_UnknownId_ReturnsNull()
    {
        await Seed();

        var dto = await Handler().Handle(new GetUserByIdQuery(Guid.NewGuid()), CancellationToken.None);

        dto.ShouldBeNull();
    }

    [Fact]
    public void UserDto_DoesNotExposePasswordHash()
    {
        typeof(WTF.Api.Features.Users.DTOs.UserDto).GetProperties().Select(p => p.Name)
            .ShouldNotContain(n => n.Contains("Password", StringComparison.OrdinalIgnoreCase));
    }
}
