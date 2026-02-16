using MediatR;

namespace WTF.Contracts.Customers.Commands;

public record UpdateCustomerCommand(
    Guid Id,
    string FirstName,
    string LastName,
    string? Address
) : IRequest<CustomerDto?>;
