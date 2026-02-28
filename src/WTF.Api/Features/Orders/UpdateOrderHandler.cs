using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record UpdateOrderCommand : IRequest<OrderDto?>
{
    [Required]
    public Guid Id { get; init; }

    [Required]
    public Guid? CustomerId { get; init; }

    [Required]
    public List<OrderItemRequestDto> Items { get; init; } = [];
    public string? SpecialInstructions { get; init; }

    [Required]
    public OrderStatusEnum Status { get; init; }

    public PaymentMethodEnum? PaymentMethod { get; init; }

    public decimal? AmountReceived { get; init; }

    public decimal? ChangeAmount { get; init; }

    public decimal? Tips { get; init; }
}

public class UpdateOrderHandler(WTFDbContext db, IHubContext<DashboardHub> dashboardHub, IAuditService auditService) : IRequestHandler<UpdateOrderCommand, OrderDto?>
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

        // Validate no nested add-ons and add-on type rules
        foreach (var item in request.Items)
        {
            if (item.AddOns.Any(addOn => addOn.AddOns?.Count > 0))
            {
                throw new InvalidOperationException("Nested add-ons are not allowed. Add-ons cannot have their own add-ons.");
            }

            var addOnIds = item.AddOns.Select(addOn => addOn.ProductId).ToList();

            var availableTypes = await db.ProductAddOns
                .Where(pa => pa.ProductId == item.ProductId)
                .Select(pa => (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra))
                .Distinct()
                .ToListAsync(cancellationToken);

            if (addOnIds.Count == 0)
            {
                if (availableTypes.Contains(AddOnTypeEnum.Size))
                {
                    throw new InvalidOperationException("A size selection is required and must be exactly one.");
                }

                if (availableTypes.Contains(AddOnTypeEnum.Flavor))
                {
                    throw new InvalidOperationException("A flavor selection is required and must be exactly one.");
                }

                continue;
            }

            var productAddOns = await db.ProductAddOns
                .Where(pa => pa.ProductId == item.ProductId && addOnIds.Contains(pa.AddOnId))
                .Select(pa => new
                {
                    pa.AddOnId,
                    AddOnType = (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra)
                })
                .ToListAsync(cancellationToken);

            if (productAddOns.Count != addOnIds.Count)
            {
                throw new InvalidOperationException("One or more add-ons are not allowed for this product.");
            }

            var selectedByType = productAddOns
                .GroupBy(pa => pa.AddOnType)
                .ToDictionary(group => group.Key, group => group.Count());

            if (availableTypes.Contains(AddOnTypeEnum.Size))
            {
                var sizeCount = selectedByType.TryGetValue(AddOnTypeEnum.Size, out var count)
                    ? count
                    : 0;

                if (sizeCount != 1)
                {
                    throw new InvalidOperationException("A size selection is required and must be exactly one.");
                }
            }

            if (availableTypes.Contains(AddOnTypeEnum.Flavor))
            {
                var flavorCount = selectedByType.TryGetValue(AddOnTypeEnum.Flavor, out var fCount)
                    ? fCount
                    : 0;

                if (flavorCount != 1)
                {
                    throw new InvalidOperationException("A flavor selection is required and must be exactly one.");
                }
            }

            if (availableTypes.Contains(AddOnTypeEnum.Sauce))
            {
                var sauceCount = selectedByType.TryGetValue(AddOnTypeEnum.Sauce, out var sCount)
                    ? sCount
                    : 0;

                if (sauceCount > 1)
                {
                    throw new InvalidOperationException("A sauce selection must be at most one.");
                }
            }
        }

        var oldStatus = (OrderStatusEnum)order.StatusId;
        var newStatus = request.Status;
        var oldValues = new
        {
            Status = oldStatus,
            order.CustomerId,
            ItemCount = order.OrderItems.Count
        };

        order.CustomerId = request.CustomerId;
        order.SpecialInstructions = request.SpecialInstructions;
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
        }

        // Update items: remove old, add new
        db.OrderItems.RemoveRange(order.OrderItems);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var item in request.Items)
        {
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            var newItem = new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                SpecialInstructions = item.SpecialInstructions,
                Price = null,
                ParentOrderItemId = null
            };

            // Capture price snapshot when order is Completed or Cancelled
            if (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled)
            {
                newItem.Price = product.Price;
            }

            db.OrderItems.Add(newItem);
            await db.SaveChangesAsync(cancellationToken);

            foreach (var addOn in item.AddOns)
            {
                var addOnProduct = await db.Products.FindAsync([addOn.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Add-on product with ID {addOn.ProductId} not found.");
                var addOnOverridePrice = await db.ProductAddOnPriceOverrides
                    .Where(o => o.ProductId == item.ProductId && o.AddOnId == addOn.ProductId && o.IsActive)
                    .Select(o => (decimal?)o.Price)
                    .FirstOrDefaultAsync(cancellationToken);
                var effectiveAddOnPrice = addOnOverridePrice ?? addOnProduct.Price;

                var addOnItem = new OrderItem
                {
                    OrderId = order.Id,
                    ProductId = addOn.ProductId,
                    Quantity = addOn.Quantity,
                    SpecialInstructions = addOn.SpecialInstructions,
                    Price = null,
                    ParentOrderItemId = newItem.Id
                };

                // Capture price if order is Completed or Cancelled
                if (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled)
                {
                    addOnItem.Price = effectiveAddOnPrice;
                }

                db.OrderItems.Add(addOnItem);
            }
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
            action: AuditAction.OrderUpdated,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                Status = newStatus,
                order.CustomerId,
                ItemCount = request.Items.Count,
                totalAmount
            },
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
