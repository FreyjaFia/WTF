using WTF.Api.Features.Users.DTOs;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

internal static class UserMapping
{
    public static UserDto ToDto(User user, string? imageUrl, string? roleName = null)
    {
        return new UserDto(
            user.Id,
            user.FirstName,
            user.LastName,
            user.Username,
            user.IsActive,
            user.CreatedAt,
            user.CreatedBy,
            user.UpdatedAt,
            user.UpdatedBy,
            imageUrl,
            user.RoleId,
            roleName ?? user.Role?.Name
        );
    }
}
