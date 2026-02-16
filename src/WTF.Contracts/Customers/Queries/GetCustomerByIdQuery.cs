using MediatR;

namespace WTF.Contracts.Customers.Queries;

public record GetCustomerByIdQuery(Guid Id) : IRequest<CustomerDto?>;
