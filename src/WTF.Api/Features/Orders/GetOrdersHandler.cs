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
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
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
            [.. o.OrderItems
                .Where(oi => oi.ParentOrderItemId == null)
                .Select(oi => new OrderItemDto(
                    oi.Id,
                    oi.ProductId,
                    oi.Product.Name,
                    oi.Quantity,
                    oi.Price,
                    [.. oi.InverseParentOrderItem.Select(child => new OrderItemDto(
                        child.Id,
                        child.ProductId,
                        child.Product.Name,
                        child.Quantity,
                        child.Price,
                        [],
                        child.SpecialInstructions
                    ))],
                    oi.SpecialInstructions
                ))],
            o.CustomerId,
            (OrderStatusEnum)o.StatusId,
            o.PaymentMethodId.HasValue ? (PaymentMethodEnum)o.PaymentMethodId.Value : null,
            o.AmountReceived,
            o.ChangeAmount,
            o.Tips,
            o.SpecialInstructions,
            o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity)
        ))];
    }
}
