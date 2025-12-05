using MediatR;

namespace WTF.Contracts.Orders.Queries;

public record GetOrdersQuery(
    int Page = 1,
    int PageSize = 10,
    int Status = 0,
    Guid? CustomerId = null
) : IRequest<List<OrderDto>>;
