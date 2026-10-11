using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Users;

public class UserMappingTests
{
    [Fact]
    public void ToDto_CopiesFieldsAndMapsRole()
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            FirstName = "Al",
            LastName = "Em",
            Username = "alem",
            IsActive = true,
            RoleId = (int)UserRoleEnum.StockManager,
            CreatedBy = Guid.NewGuid()
        };

        var dto = UserMapping.ToDto(user, "img");

        dto.Id.ShouldBe(user.Id);
        dto.Username.ShouldBe("alem");
        dto.RoleId.ShouldBe(UserRoleEnum.StockManager);
        dto.ImageUrl.ShouldBe("img");
        dto.CreatedBy.ShouldBe(user.CreatedBy);
    }

    [Fact]
    public void ToDto_DoesNotExposePasswordHash()
    {
        typeof(WTF.Api.Features.Users.DTOs.UserDto).GetProperties()
            .ShouldNotContain(p => p.Name.Contains("Password", StringComparison.OrdinalIgnoreCase));
    }
}
