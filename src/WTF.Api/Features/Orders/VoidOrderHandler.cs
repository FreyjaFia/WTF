using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record VoidOrderCommand(Guid Id) : IRequest<OrderDto?>;

public class VoidOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService) : IRequestHandler<VoidOrderCommand, OrderDto?>
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
        var newStatus = currentStatus == OrderStatusEnum.Completed
            ? OrderStatusEnum.Refunded
            : OrderStatusEnum.Cancelled;

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
        order.StatusId = (int)newStatus;
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

        var allOrderItems = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id)
            .Include(oi => oi.Product)
            .ToListAsync(cancellationToken);

        var parentItems = allOrderItems.Where(oi => oi.ParentOrderItemId == null).ToList();
        var parentProductIds = parentItems.Select(oi => oi.ProductId).Distinct().ToList();
        var addOnProductIds = allOrderItems
            .Where(oi => oi.ParentOrderItemId != null)
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var overridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();
        if (addOnProductIds.Count > 0)
        {
            overridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => parentProductIds.Contains(o.ProductId)
                    && addOnProductIds.Contains(o.AddOnId)
                    && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        var totalAmount = parentItems.Sum(parent =>
        {
            var parentUnitPrice = parent.Price ?? parent.Product.Price;
            var addOnPerUnit = allOrderItems
                .Where(child => child.ParentOrderItemId == parent.Id)
                .Sum(child =>
                {
                    var effectivePrice = child.Price
                        ?? (overridePrices.TryGetValue((parent.ProductId, child.ProductId), out var op)
                            ? op
                            : child.Product.Price);
                    return effectivePrice * child.Quantity;
                });

            return (parentUnitPrice + addOnPerUnit) * parent.Quantity;
        });

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderVoided,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: new
            {
                Status = currentStatus
            },
            newValues: new
            {
                Status = newStatus,
                totalAmount
            },
            userId: userId,
            cancellationToken: cancellationToken);

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
