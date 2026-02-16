using MediatR;

namespace WTF.Contracts.Customers.Commands;

public record CreateCustomerCommand(
    string FirstName,
    string LastName,
    string? Address
) : IRequest<CustomerDto>;
