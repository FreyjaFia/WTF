using MediatR;

namespace WTF.Contracts.Users.Queries;

public record GetUserByIdQuery(Guid Id) : IRequest<UserDto?>;