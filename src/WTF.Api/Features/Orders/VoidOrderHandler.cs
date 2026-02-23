using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record VoidOrderCommand(Guid Id) : IRequest<OrderDto?>;

public class VoidOrderHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IHubContext<DashboardHub> dashboardHub) : IRequestHandler<VoidOrderCommand, OrderDto?>
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

        // Capture price snapshot (resolve add-on overrides)
        var parentProductByOrderItemId = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null)
            .ToDictionary(oi => oi.Id, oi => oi.ProductId);

        foreach (var orderItem in order.OrderItems)
        {
            if (orderItem.Price != null)
            {
                continue;
            }

            if (orderItem.ParentOrderItemId == null)
            {
                orderItem.Price = orderItem.Product.Price;
                continue;
            }

            if (!parentProductByOrderItemId.TryGetValue(orderItem.ParentOrderItemId.Value, out var parentProductId))
            {
                orderItem.Price = orderItem.Product.Price;
                continue;
            }

            var overridePrice = await db.ProductAddOnPriceOverrides
                .Where(o => o.ProductId == parentProductId && o.AddOnId == orderItem.ProductId && o.IsActive)
                .Select(o => (decimal?)o.Price)
                .FirstOrDefaultAsync(cancellationToken);

            orderItem.Price = overridePrice ?? orderItem.Product.Price;
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
                    new List<OrderItemDto>(),
                    child.SpecialInstructions
                )).ToList(),
                oi.SpecialInstructions
            ))
            .ToListAsync(cancellationToken);

        var totalAmount = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Include(oi => oi.Product)
            .SumAsync(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity, cancellationToken);

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);

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
            order.SpecialInstructions,
            totalAmount
        );
    }
}
