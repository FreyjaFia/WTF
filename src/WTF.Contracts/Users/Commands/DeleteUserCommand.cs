using MediatR;

namespace WTF.Contracts.Users.Commands;

public record DeleteUserCommand(Guid Id) : IRequest<bool>;