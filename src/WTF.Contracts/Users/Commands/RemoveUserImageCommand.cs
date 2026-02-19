using MediatR;
using WTF.Contracts.Users;

namespace WTF.Contracts.Users.Commands;

public record RemoveUserImageCommand(Guid UserId) : IRequest<UserDto?>;
