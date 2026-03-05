using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record CreateOrderCommand : IRequest<OrderDto>
{
    [Required]
    public Guid? CustomerId { get; init; }

    [Required]
    public List<OrderItemRequestDto> Items { get; init; } = [];
    public List<OrderBundlePromotionRequestDto> BundlePromotions { get; init; } = [];
    public string? SpecialInstructions { get; init; }
    public string? Note { get; init; }

    [Required]
    public OrderStatusEnum Status { get; init; }

    public PaymentMethodEnum? PaymentMethod { get; init; }

    public decimal? AmountReceived { get; init; }

    public decimal? ChangeAmount { get; init; }

    public decimal? Tips { get; init; }

    public DateTime? CreatedAt { get; init; }
}

public class CreateOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService) : IRequestHandler<CreateOrderCommand, OrderDto>
{
    public async Task<OrderDto> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

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

        var createdAt = request.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow;

        var requestedProductIds = request.Items
            .Select(i => i.ProductId)
            .Concat(request.Items.SelectMany(i => i.AddOns.Select(a => a.ProductId)))
            .Distinct()
            .ToList();

        var activeProductMap = await db.Products
            .Where(p => requestedProductIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Name, p.IsActive })
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        var inactiveProductNames = activeProductMap.Values
            .Where(p => !p.IsActive)
            .Select(p => p.Name)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        if (inactiveProductNames.Count > 0)
        {
            throw new InvalidOperationException(
                $"Cannot save order with inactive products/add-ons: {string.Join(", ", inactiveProductNames)}.");
        }

        if (activeProductMap.Count != requestedProductIds.Count)
        {
            throw new InvalidOperationException("One or more selected products/add-ons were not found.");
        }

        var requestedBundlePromotions = request.BundlePromotions
            .GroupBy(b => b.PromotionId)
            .Select(group =>
            {
                if (group.Count() > 1)
                {
                    throw new InvalidOperationException("Duplicate bundle promotions are not allowed.");
                }

                var entry = group.Single();
                if (entry.Quantity <= 0)
                {
                    throw new InvalidOperationException("Bundle promotion quantity must be greater than zero.");
                }

                return entry;
            })
            .ToList();

        var bundlePromotionIds = requestedBundlePromotions.Select(b => b.PromotionId).ToHashSet();
        foreach (var item in request.Items)
        {
            if (item.BundlePromotionId.HasValue && !bundlePromotionIds.Contains(item.BundlePromotionId.Value))
            {
                throw new InvalidOperationException("Order item references an unknown bundle promotion.");
            }
        }

        Dictionary<Guid, decimal> bundlePriceByPromotionId = [];
        if (requestedBundlePromotions.Count > 0)
        {
            var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
            var referenceUtc = request.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow;

            var bundlePromotionEntities = await db.Promotions
                .Where(p =>
                    bundlePromotionIds.Contains(p.Id)
                    && (p.FixedBundlePromotion != null || p.MixMatchPromotion != null))
                .Include(p => p.FixedBundlePromotion)
                .Include(p => p.MixMatchPromotion)
                .ToListAsync(cancellationToken);

            if (bundlePromotionEntities.Count != requestedBundlePromotions.Count)
            {
                throw new InvalidOperationException("One or more bundle promotions are invalid.");
            }

            foreach (var promotion in bundlePromotionEntities)
            {
                if (!IsPromotionActiveOnLocalDate(promotion, referenceUtc, timeZone))
                {
                    throw new InvalidOperationException($"Bundle promotion '{promotion.Name}' is inactive or outside its active date range.");
                }
            }

            bundlePriceByPromotionId = bundlePromotionEntities.ToDictionary(
                p => p.Id,
                p => p.FixedBundlePromotion != null
                    ? p.FixedBundlePromotion.BundlePrice
                    : p.MixMatchPromotion!.BundlePrice);
        }

        var order = new Order
        {
            CreatedAt = createdAt,
            CreatedBy = userId,
            CustomerId = request.CustomerId,
            SpecialInstructions = request.SpecialInstructions,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            StatusId = (int)request.Status,
            PaymentMethodId = request.PaymentMethod.HasValue ? (int)request.PaymentMethod.Value : null,
            AmountReceived = request.AmountReceived,
            ChangeAmount = request.ChangeAmount,
            Tips = request.Tips
        };

        db.Orders.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        if (requestedBundlePromotions.Count > 0)
        {
            var orderBundlePromotions = requestedBundlePromotions.Select(bundle => new OrderBundlePromotion
            {
                OrderId = order.Id,
                PromotionId = bundle.PromotionId,
                Quantity = bundle.Quantity,
                UnitPrice = bundlePriceByPromotionId[bundle.PromotionId]
            });

            db.OrderBundlePromotions.AddRange(orderBundlePromotions);
        }

        // Add order items with parent-child relationships
        foreach (var item in request.Items)
        {
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            var orderItem = new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                SpecialInstructions = item.SpecialInstructions,
                Price = null,
                ParentOrderItemId = null,
                BundlePromotionId = item.BundlePromotionId
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
                var addOnProduct = await db.Products.FindAsync([addOn.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Add-on product with ID {addOn.ProductId} not found.");
                var addOnOverridePrice = await db.ProductAddOnPriceOverrides
                    .Where(o => o.ProductId == item.ProductId && o.AddOnId == addOn.ProductId && o.IsActive)
                    .Select(o => (decimal?)o.Price)
                    .FirstOrDefaultAsync(cancellationToken);
                var effectiveAddOnPrice = addOnOverridePrice ?? addOnProduct.Price;

                var addOnOrderItem = new OrderItem
                {
                    OrderId = order.Id,
                    ProductId = addOn.ProductId,
                    Quantity = addOn.Quantity,
                    SpecialInstructions = addOn.SpecialInstructions,
                    Price = null,
                    ParentOrderItemId = orderItem.Id,
                    BundlePromotionId = item.BundlePromotionId
                };

                // Capture price if order is Completed or Cancelled
                if (request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled)
                {
                    addOnOrderItem.Price = effectiveAddOnPrice;
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

        var orderWithTotals = await db.Orders
            .AsNoTracking()
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .FirstAsync(o => o.Id == order.Id, cancellationToken);
        var totalAmount = OrderMetrics.ComputeOrderTotal(orderWithTotals);

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderCreated,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            newValues: new
            {
                order.OrderNumber,
                order.StatusId,
                order.CustomerId,
                ItemCount = items.Count,
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

    private static bool IsPromotionActiveOnLocalDate(Promotion promotion, DateTime utcReference, TimeZoneInfo timeZone)
    {
        if (!promotion.IsActive)
        {
            return false;
        }

        var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcReference, DateTimeKind.Utc), timeZone);
        var localDate = localNow.Date;

        var startLocalDate = promotion.StartDate.HasValue
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(promotion.StartDate.Value, DateTimeKind.Utc), timeZone).Date
            : (DateTime?)null;
        var endLocalDate = promotion.EndDate.HasValue
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(promotion.EndDate.Value, DateTimeKind.Utc), timeZone).Date
            : (DateTime?)null;

        if (startLocalDate.HasValue && localDate < startLocalDate.Value)
        {
            return false;
        }

        if (endLocalDate.HasValue && localDate > endLocalDate.Value)
        {
            return false;
        }

        return true;
    }
}
