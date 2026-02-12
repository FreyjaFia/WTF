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
            .Include(oi => oi.Product)
            .Select(oi => new OrderItemDto(oi.Id, oi.ProductId, oi.Quantity))
            .ToListAsync(cancellationToken);

        var totalAmount = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Include(oi => oi.Product)
            .SumAsync(oi => oi.Product.Price * oi.Quantity, cancellationToken);

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
