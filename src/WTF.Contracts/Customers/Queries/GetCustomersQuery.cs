using MediatR;

namespace WTF.Contracts.Customers.Queries;

public record GetCustomersQuery(
    string? SearchTerm = null,
    bool? IsActive = true
) : IRequest<List<CustomerDto>>;
