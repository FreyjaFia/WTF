using MediatR;

namespace WTF.Contracts.Customers.Queries;

public record GetCustomersQuery : IRequest<List<CustomerDto>>
{
    public string? SearchTerm { get; init; }
    public bool? IsActive { get; init; } = true;
}
