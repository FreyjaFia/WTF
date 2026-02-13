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

        // Validate no nested add-ons
        foreach (var item in request.Items)
        {
            if (item.AddOns.Any(addOn => addOn.AddOns.Count != 0))
            {
                throw new InvalidOperationException("Nested add-ons are not allowed. Add-ons cannot have their own add-ons.");
            }
        }

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

        // Add order items with parent-child relationships
        foreach (var item in request.Items)
        {
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken);

            if (product == null)
            {
                throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            }

            var orderItem = new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                Price = null,
                ParentOrderItemId = null
            };

            // Capture price if order is Completed or Cancelled
            if (request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled)
            {
                orderItem.Price = product.Price;
            }

            db.OrderItems.Add(orderItem);
            await db.SaveChangesAsync(cancellationToken);

            // Add child items (add-ons)
            foreach (var addOn in item.AddOns)
            {
                var addOnProduct = await db.Products.FindAsync([addOn.ProductId], cancellationToken);

                if (addOnProduct == null)
                {
                    throw new InvalidOperationException($"Add-on product with ID {addOn.ProductId} not found.");
                }

                var addOnOrderItem = new OrderItem
                {
                    OrderId = order.Id,
                    ProductId = addOn.ProductId,
                    Quantity = addOn.Quantity,
                    Price = null,
                    ParentOrderItemId = orderItem.Id
                };

                // Capture price if order is Completed or Cancelled
                if (request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled)
                {
                    addOnOrderItem.Price = addOnProduct.Price;
                }

                db.OrderItems.Add(addOnOrderItem);
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        // Get items with hierarchy
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
