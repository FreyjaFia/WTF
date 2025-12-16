using MediatR;

namespace WTF.Contracts.Orders.Queries;

public record GetOrderByIdQuery(Guid Id) : IRequest<OrderDto?>;
