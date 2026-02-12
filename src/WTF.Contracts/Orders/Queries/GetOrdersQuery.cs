using MediatR;
using WTF.Contracts.Orders.Enums;

namespace WTF.Contracts.Orders.Queries;

public record GetOrdersQuery(
    OrderStatusEnum Status = OrderStatusEnum.All,
    Guid? CustomerId = null
) : IRequest<List<OrderDto>>;
