using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record VoidOrderCommand(Guid Id, string? Note = null) : IRequest<OrderDto?>;

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
            .Include(o => o.OrderBundlePromotions)
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
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();

        if (newStatus == OrderStatusEnum.Refunded && string.IsNullOrWhiteSpace(note))
        {
            throw new InvalidOperationException("Refund note is required.");
        }

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
        order.Note = note;
        order.UpdatedAt = DateTime.UtcNow;
        order.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        // Build response
        var items = await db.OrderItems
            .Where(oi => oi.OrderId == order.Id && oi.ParentOrderItemId == null)
            .Include(oi => oi.Product)
            .Include(oi => oi.InverseParentOrderItem)
                .ThenInclude(child => child.Product)
            .OrderBy(oi => oi.SortOrder)
            .ThenBy(oi => oi.Id)
            .Select(oi => new OrderItemDto(
                oi.Id,
                oi.ProductId,
                oi.Product.Name,
                oi.Quantity,
                oi.Price,
                oi.InverseParentOrderItem
                    .OrderBy(child => child.SortOrder)
                    .ThenBy(child => child.Id)
                    .Select(child => new OrderItemDto(
                        child.Id,
                        child.ProductId,
                        child.Product.Name,
                        child.Quantity,
                        child.Price,
                        new List<OrderItemDto>(),
                        child.SpecialInstructions,
                        child.BundlePromotionId
                    )).ToList(),
                oi.SpecialInstructions,
                oi.BundlePromotionId
            ))
            .ToListAsync(cancellationToken);

        var bundlePromotions = await db.OrderBundlePromotions
            .Where(obp => obp.OrderId == order.Id)
            .Include(obp => obp.Promotion)
            .Select(obp => new OrderBundlePromotionDto(
                obp.PromotionId,
                obp.Promotion.Name,
                obp.Quantity,
                obp.UnitPrice))
            .ToListAsync(cancellationToken);

        var parentProductIds = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null)
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var addOnProductIds = order.OrderItems
            .Where(oi => oi.ParentOrderItemId != null)
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var overridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();
        if (addOnProductIds.Count > 0)
        {
            overridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => parentProductIds.Contains(o.ProductId) && addOnProductIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        var totalAmount = OrderMetrics.ComputeOrderTotal(order, overridePrices);

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
                Note = order.Note,
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
            order.Note,
            totalAmount,
            null,
            bundlePromotions
        );
    }
}
