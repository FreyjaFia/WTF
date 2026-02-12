using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Orders.Queries;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public class GetOrdersHandler(WTFDbContext db) : IRequestHandler<GetOrdersQuery, List<OrderDto>>
{
    public async Task<List<OrderDto>> Handle(GetOrdersQuery request, CancellationToken cancellationToken)
    {
        var query = db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .AsQueryable();

        if (request.CustomerId.HasValue)
        {
            query = query.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        if (request.Status != OrderStatusEnum.All)
        {
            query = query.Where(o => o.StatusId == (int)request.Status);
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync(cancellationToken);

        return [.. orders.Select(o => new OrderDto(
            o.Id,
            o.OrderNumber,
            o.CreatedAt,
            o.CreatedBy,
            o.UpdatedAt,
            o.UpdatedBy,
            [.. o.OrderItems.Select(oi => new OrderItemDto(oi.Id, oi.ProductId, oi.Quantity))],
            o.CustomerId,
            (OrderStatusEnum)o.StatusId,
            o.PaymentMethodId.HasValue ? (PaymentMethodEnum)o.PaymentMethodId.Value : null,
            o.AmountReceived,
            o.ChangeAmount,
            o.Tips,
            o.OrderItems.Sum(oi => oi.Product.Price * oi.Quantity)
        ))];
    }
}
