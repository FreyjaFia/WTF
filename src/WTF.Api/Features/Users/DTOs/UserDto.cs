using WTF.Api.Features.Users.Enums;

namespace WTF.Api.Features.Users.DTOs;

public record UserDto(Guid Id, string FirstName, string LastName, string Username, bool IsActive, string? ImageUrl, UserRoleEnum RoleId);
