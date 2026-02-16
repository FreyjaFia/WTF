using MediatR;

namespace WTF.Contracts.Customers.Commands;

public record DeleteCustomerCommand(Guid Id) : IRequest<bool>;
