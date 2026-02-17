using MediatR;

namespace WTF.Contracts.Users.Commands;

public record CreateUserCommand(
    string FirstName,
    string LastName,
    string Username,
    string Password
) : IRequest<UserDto>;