using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public class CreateOrderHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateOrderCommand, OrderDto>
{
    public async Task<OrderDto> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var order = new Order
        {
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            CustomerId = request.CustomerId,
            StatusId = (int)request.Status,
            PaymentMethodId = request.PaymentMethod.HasValue ? (int)request.PaymentMethod.Value : null,
            AmountReceived = request.AmountReceived,
            ChangeAmount = request.ChangeAmount,
            Tips = request.Tips
        };

        db.Orders.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        // Add order items
        foreach (var item in request.Items)
        {
            var orderItem = new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                Price = item.Price
            };

            // If order is Completed or Cancelled, capture price if not already set
            if (request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled)
            {
                if (orderItem.Price == null)
                {
                    var product = await db.Products.FindAsync([item.ProductId], cancellationToken);
                    orderItem.Price = product?.Price;
                }
            }

            db.OrderItems.Add(orderItem);
        }
        await db.SaveChangesAsync(cancellationToken);

        var items = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Include(oi => oi.Product)
            .Select(oi => new OrderItemDto(oi.Id, oi.ProductId, oi.Quantity, oi.Price))
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
