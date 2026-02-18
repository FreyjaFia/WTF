using MediatR;

namespace WTF.Contracts.Users.Queries;

public record GetUsersQuery : IRequest<List<UserDto>>
{
    public bool? IsActive { get; init; } = true;
    public string? SearchTerm { get; init; }
}
