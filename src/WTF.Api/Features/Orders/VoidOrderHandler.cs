using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public class VoidOrderHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<VoidOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(VoidOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return null;
        }

        var currentStatus = (OrderStatusEnum)order.StatusId;

        if (currentStatus == OrderStatusEnum.Cancelled || currentStatus == OrderStatusEnum.Refunded)
        {
            throw new InvalidOperationException("Order has already been voided.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        // Capture price snapshot
        foreach (var orderItem in order.OrderItems)
        {
            orderItem.Price ??= orderItem.Product.Price;
        }

        // Pending -> Cancelled, Completed -> Refunded
        order.StatusId = currentStatus == OrderStatusEnum.Completed
            ? (int)OrderStatusEnum.Refunded
            : (int)OrderStatusEnum.Cancelled;
        order.UpdatedAt = DateTime.UtcNow;
        order.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        // Build response
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
