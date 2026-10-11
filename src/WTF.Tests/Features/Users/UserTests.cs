using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Users;

public class UserValidationTests
{
    [Fact]
    public void EnsureValidUsername_Present_DoesNotThrow()
    {
        Should.NotThrow(() => UserValidation.EnsureValidUsername("alain"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void EnsureValidUsername_Blank_Throws(string username)
    {
        Should.Throw<InvalidOperationException>(() => UserValidation.EnsureValidUsername(username))
            .Message.ShouldBe("Username is required.");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void EnsureValidPassword_CreateWithoutPassword_Throws(string? password)
    {
        Should.Throw<InvalidOperationException>(() => UserValidation.EnsureValidPassword(password))
            .Message.ShouldBe("Password is required.");
    }

    [Fact]
    public void EnsureValidPassword_CreateWithPassword_DoesNotThrow()
    {
        Should.NotThrow(() => UserValidation.EnsureValidPassword("secret"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void EnsureValidPassword_UpdateWithoutPassword_IsAllowed(string? password)
    {
        Should.NotThrow(() => UserValidation.EnsureValidPassword(password, isUpdate: true));
    }
}

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
