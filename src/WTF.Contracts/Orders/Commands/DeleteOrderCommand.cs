using MediatR;

namespace WTF.Contracts.Orders.Commands;

public record DeleteOrderCommand(Guid Id) : IRequest<bool>;
