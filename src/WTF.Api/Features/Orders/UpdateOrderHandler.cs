using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public class UpdateOrderHandler(WTFDbContext db) : IRequestHandler<UpdateOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(UpdateOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return null;
        }

        var oldStatus = (OrderStatusEnum)order.StatusId;
        var newStatus = request.Status;

        order.CustomerId = request.CustomerId;
        order.StatusId = (int)request.Status;
        order.PaymentMethodId = request.PaymentMethod.HasValue ? (int)request.PaymentMethod.Value : null;
        order.AmountReceived = request.AmountReceived;
        order.ChangeAmount = request.ChangeAmount;
        order.Tips = request.Tips;
        order.UpdatedAt = DateTime.UtcNow;

        // Capture price snapshot when order changes to Completed or Cancelled
        if (oldStatus == OrderStatusEnum.Pending && 
            (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled))
        {
            foreach (var orderItem in order.OrderItems)
            {
                orderItem.Price ??= orderItem.Product.Price;
            }
        }

        // Update items: remove old, add new
        db.OrderItems.RemoveRange(order.OrderItems);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var item in request.Items)
        {
            var newItem = new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                Price = item.Price
            };

            // If completing order and price not set, capture current product price
            if (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled)
            {
                if (newItem.Price == null)
                {
                    var product = await db.Products.FindAsync([item.ProductId], cancellationToken);
                    newItem.Price = product?.Price;
                }
            }

            db.OrderItems.Add(newItem);
        }

        await db.SaveChangesAsync(cancellationToken);

        var items = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id && oi.ParentOrderItemId == null)
            .Include(oi => oi.Product)
            .Include(oi => oi.InverseParentOrderItem)
                .ThenInclude(child => child.Product)
            .Select(oi => new OrderItemDto(
                oi.Id,
                oi.ProductId,
                oi.Product.Name,
                oi.Quantity,
                oi.Price,
                oi.InverseParentOrderItem.Select(child => new OrderItemDto(
                    child.Id,
                    child.ProductId,
                    child.Product.Name,
                    child.Quantity,
                    child.Price,
                    new List<OrderItemDto>()
                )).ToList()
            ))
            .ToListAsync(cancellationToken);

        var totalAmount = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Include(oi => oi.Product)
            .SumAsync(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity, cancellationToken);

        return new OrderDto(
            order.Id,
            order.OrderNumber,
            order.CreatedAt,
            order.CreatedBy,
            order.UpdatedAt,
            order.UpdatedBy,
            items,
            order.CustomerId,
            (OrderStatusEnum)order.StatusId,
            order.PaymentMethodId.HasValue ? (PaymentMethodEnum)order.PaymentMethodId.Value : null,
            order.AmountReceived,
            order.ChangeAmount,
            order.Tips,
            totalAmount
        );
    }
}
