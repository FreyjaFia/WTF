using MediatR;
using WTF.Contracts.Customers;

namespace WTF.Contracts.Customers.Commands;

public record RemoveCustomerImageCommand(Guid CustomerId) : IRequest<CustomerDto?>;
