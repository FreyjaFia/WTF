using MediatR;

namespace WTF.Contracts.Users.Commands;

public record UpdateUserCommand(
    Guid Id,
    string FirstName,
    string LastName,
    string Username,
    string? Password
) : IRequest<UserDto?>;