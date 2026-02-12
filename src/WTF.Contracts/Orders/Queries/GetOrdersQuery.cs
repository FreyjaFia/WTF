using MediatR;
using WTF.Contracts.Orders.Enums;

namespace WTF.Contracts.Orders.Queries;

public record GetOrdersQuery(
    int Page = 1,
    int PageSize = 10,
    OrderStatusEnum Status = OrderStatusEnum.All,
    Guid? CustomerId = null
) : IRequest<List<OrderDto>>;
