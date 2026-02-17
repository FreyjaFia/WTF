using MediatR;

namespace WTF.Contracts.Users.Queries;

public record GetUsersQuery(
    bool? IsActive = null,
    string? SearchTerm = null
) : IRequest<List<UserDto>>;