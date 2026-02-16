using MediatR;

namespace WTF.Contracts.Orders.Commands;

public record VoidOrderCommand(Guid Id) : IRequest<OrderDto?>;
