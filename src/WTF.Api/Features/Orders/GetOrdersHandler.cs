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
        var query = db.Orders.Include(o => o.OrderItems).Include(o => o.Status).AsQueryable();

        if (request.CustomerId.HasValue)
        {
            query = query.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        // Only filter by status if not "All" (-1)
        if (request.Status != (int)OrderStatusEnum.All)
        {
            query = query.Where(o => o.Status.Id == request.Status);
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(cancellationToken);

        return orders.Select(o => new OrderDto(
            o.Id,
            o.OrderNumber,
            o.CreatedAt,
            o.CreatedBy,
            o.UpdatedAt,
            o.UpdatedBy,
            o.OrderItems.Select(oi => new OrderItemDto(oi.Id, oi.ProductId, oi.Quantity)).ToList(),
            o.CustomerId,
            (OrderStatusEnum)o.Status.Id
        )).ToList();
    }
}
