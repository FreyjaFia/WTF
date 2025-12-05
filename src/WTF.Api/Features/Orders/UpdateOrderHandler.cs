using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public class UpdateOrderHandler(WTFDbContext db) : IRequestHandler<UpdateOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(UpdateOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.Include(o => o.OrderItems)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return null;
        }

        var status = await db.Statuses.FirstOrDefaultAsync(s => s.Id == request.Status, cancellationToken);
        if (status is null)
        {
            throw new Exception("Invalid status");
        }

        order.CustomerId = request.CustomerId;
        order.StatusId = status.Id;
        order.UpdatedAt = DateTime.UtcNow;

        // Update items: remove old, add new
        db.OrderItems.RemoveRange(order.OrderItems);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var item in request.Items)
        {
            db.OrderItems.Add(new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        var items = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Select(oi => new OrderItemDto(oi.Id, oi.ProductId, oi.Quantity))
            .ToListAsync(cancellationToken);

        return new OrderDto(
            order.Id,
            order.OrderNumber,
            order.CreatedAt,
            order.CreatedBy,
            order.UpdatedAt,
            order.UpdatedBy,
            items,
            order.CustomerId,
            status.Id
        );
    }
}
