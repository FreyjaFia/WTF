using MediatR;
using WTF.Contracts.Users.Enums;

namespace WTF.Contracts.Users.Commands;

public record UpdateUserCommand(
    Guid Id,
    string FirstName,
    string LastName,
    string Username,
    string? Password,
    UserRoleEnum RoleId
) : IRequest<UserDto?>;
