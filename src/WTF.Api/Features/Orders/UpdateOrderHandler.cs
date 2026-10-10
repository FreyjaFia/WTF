using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions.DTOs;
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
    public List<OrderBundlePromotionRequestDto> BundlePromotions { get; init; } = [];
    public string? SpecialInstructions { get; init; }
    public string? Note { get; init; }

    [Required]
    public OrderStatusEnum Status { get; init; }

    public PaymentMethodEnum? PaymentMethod { get; init; }

    public decimal? AmountReceived { get; init; }

    public decimal? ChangeAmount { get; init; }

    public decimal? Tips { get; init; }

    /// <summary>Why a completed order is being corrected. Only used by the override endpoint.</summary>
    public string? OverrideReason { get; init; }

    /// <summary>
    /// Set by the override endpoint only (never bound from the request body), so regular
    /// updates can never touch a completed order.
    /// </summary>
    [JsonIgnore]
    public bool IsOverride { get; init; }
}

public class UpdateOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IPushNotificationService pushNotifications) : IRequestHandler<UpdateOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(UpdateOrderCommand request, CancellationToken cancellationToken)
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

        // Validate no nested add-ons and add-on type rules
        foreach (var item in request.Items)
        {
            if (item.AddOns.Any(addOn => addOn.AddOns?.Count > 0))
            {
                throw new InvalidOperationException("Nested add-ons are not allowed. Add-ons cannot have their own add-ons.");
            }

            var addOnIds = item.AddOns.Select(addOn => addOn.ProductId).ToList();

            var availableTypes = await db.ProductAddOns
                .Where(pa => pa.IsActive)
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
                .Where(pa => pa.IsActive)
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
            var referenceUtc = DateTime.UtcNow;

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

            if (bundlePriceByPromotionId.Values.Any(price => price < 0))
            {
                throw new InvalidOperationException("The bundle price cannot be negative.");
            }
        }

        var oldStatus = (OrderStatusEnum)order.StatusId;
        var newStatus = request.Status;
        var isOverride = request.IsOverride;
        var overrideReason = request.OverrideReason?.Trim();
        if (isOverride)
        {
            if (oldStatus != OrderStatusEnum.Completed)
            {
                throw new InvalidOperationException("Only completed orders can be overridden.");
            }

            if (newStatus != OrderStatusEnum.Completed)
            {
                throw new InvalidOperationException("An overridden order must stay completed. Use refund to void it.");
            }

            if (string.IsNullOrWhiteSpace(overrideReason))
            {
                throw new InvalidOperationException("An override reason is required.");
            }
        }
        else if (oldStatus != OrderStatusEnum.Pending)
        {
            throw new InvalidOperationException(
                $"Order is already {oldStatus} and cannot be updated.");
        }

        var shouldCapturePrice = newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled;
        Dictionary<Guid, List<DiscountedRule>> discountedRulesByProductId = [];
        if (shouldCapturePrice)
        {
            var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
            var referenceUtc = DateTime.UtcNow;

            var discountedPromotions = await db.Promotions
                .Where(p => p.TypeId == PromotionTypeIds.DiscountedProduct)
                .Include(p => p.DiscountedProductPromotions)
                    .ThenInclude(d => d.DiscountedProductPromotionAddOns)
                .ToListAsync(cancellationToken);

            discountedRulesByProductId = discountedPromotions
                .Where(p => IsPromotionActiveOnLocalDate(p, referenceUtc, timeZone))
                .SelectMany(p => p.DiscountedProductPromotions)
                .GroupBy(d => d.ProductId)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(d => new DiscountedRule(
                        d.FixedPrice,
                        d.PercentOff,
                        d.DiscountedProductPromotionAddOns
                            .Select(a => (a.AddOnProductId, a.Quantity))
                            .ToList()))
                        .ToList());
        }

        var pricedItems = new List<(
            OrderItemRequestDto Item,
            Product Product,
            decimal? DiscountedPrice,
            AppliedDiscount? AppliedDiscount,
            List<(OrderItemRequestDto AddOn, decimal Price)> AddOnPrices)>();

        for (var itemIndex = 0; itemIndex < request.Items.Count; itemIndex++)
        {
            var item = request.Items[itemIndex];
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            var basePrice = product.Price;
            var appliedDiscount = shouldCapturePrice
                ? GetDiscountedUnitPrice(basePrice, item, discountedRulesByProductId)
                : null;
            var discountedPrice = appliedDiscount?.Price;
            var addOnPrices = new List<(OrderItemRequestDto AddOn, decimal Price)>();
            foreach (var addOn in item.AddOns)
            {
                var addOnProduct = await db.Products.FindAsync([addOn.ProductId], cancellationToken)
                    ?? throw new InvalidOperationException($"Add-on product with ID {addOn.ProductId} not found.");
                var addOnOverridePrice = await db.ProductAddOnPriceOverrides
                    .Where(o => o.ProductId == item.ProductId && o.AddOnId == addOn.ProductId && o.IsActive)
                    .Select(o => (decimal?)o.Price)
                    .FirstOrDefaultAsync(cancellationToken);
                addOnPrices.Add((addOn, addOnOverridePrice ?? addOnProduct.Price));
            }

            var finalUnitPrice = (discountedPrice ?? basePrice)
                + addOnPrices.Sum(addOn => addOn.Price * addOn.AddOn.Quantity);
            if (!item.BundlePromotionId.HasValue && finalUnitPrice < 0)
            {
                throw new InvalidOperationException($"The final unit price for '{product.Name}' cannot be negative.");
            }

            pricedItems.Add((item, product, discountedPrice, appliedDiscount, addOnPrices));
        }

        object oldValues = new
        {
            Status = oldStatus,
            order.CustomerId,
            ItemCount = order.OrderItems.Count
        };

        // An override keeps the prices the customer already paid for lines that are still on the
        // order (same product and bundle), so later promo changes do not reprice them.
        var priceSnapshots = new Dictionary<(Guid ProductId, Guid? BundleId), Queue<(decimal? Price, decimal? OriginalPrice, string? PromoLabel)>>();
        var addOnPriceSnapshots = new Dictionary<(Guid ParentProductId, Guid AddOnId), decimal>();
        if (isOverride)
        {
            oldValues = BuildOrderSnapshot(order);

            var oldParents = order.OrderItems.Where(oi => oi.ParentOrderItemId == null).ToList();
            foreach (var parent in oldParents.OrderBy(oi => oi.SortOrder))
            {
                var key = (parent.ProductId, parent.BundlePromotionId);
                if (!priceSnapshots.TryGetValue(key, out var queue))
                {
                    queue = new Queue<(decimal?, decimal?, string?)>();
                    priceSnapshots[key] = queue;
                }

                queue.Enqueue((parent.Price, parent.OriginalPrice, parent.PromoLabel));

                foreach (var child in order.OrderItems.Where(oi => oi.ParentOrderItemId == parent.Id && oi.Price.HasValue))
                {
                    addOnPriceSnapshots.TryAdd((parent.ProductId, child.ProductId), child.Price!.Value);
                }
            }
        }

        order.CustomerId = request.CustomerId;
        order.SpecialInstructions = request.SpecialInstructions;
        order.Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        order.StatusId = (int)request.Status;
        order.PaymentMethodId = request.PaymentMethod.HasValue ? (int)request.PaymentMethod.Value : null;
        order.AmountReceived = request.AmountReceived;
        order.ChangeAmount = request.ChangeAmount;
        order.Tips = request.Tips;
        order.UpdatedAt = DateTime.UtcNow;
        if (isOverride)
        {
            order.UpdatedBy = httpContextAccessor.HttpContext?.User.GetUserId();
            order.OverrideReason = overrideReason;
            order.OverriddenAt = order.UpdatedAt;
        }

        // Update items: remove old, add new
        db.OrderItems.RemoveRange(order.OrderItems);
        db.OrderBundlePromotions.RemoveRange(order.OrderBundlePromotions);

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

        for (var itemIndex = 0; itemIndex < pricedItems.Count; itemIndex++)
        {
            var (item, product, discountedPrice, appliedDiscount, addOnPrices) = pricedItems[itemIndex];
            var newItem = new OrderItem
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                SpecialInstructions = item.SpecialInstructions,
                Price = null,
                SortOrder = itemIndex,
                ParentOrderItemId = null,
                BundlePromotionId = item.BundlePromotionId
            };

            // Capture price snapshot when order is Completed or Cancelled
            if (shouldCapturePrice)
            {
                newItem.Price = discountedPrice ?? product.Price;
                newItem.OriginalPrice = product.Price;
                newItem.PromoLabel = appliedDiscount?.Label;

                if (isOverride
                    && priceSnapshots.TryGetValue((item.ProductId, item.BundlePromotionId), out var snapshots)
                    && snapshots.Count > 0)
                {
                    var snapshot = snapshots.Dequeue();
                    newItem.Price = snapshot.Price ?? newItem.Price;
                    newItem.OriginalPrice = snapshot.OriginalPrice;
                    newItem.PromoLabel = snapshot.PromoLabel;
                }
            }

            db.OrderItems.Add(newItem);

            foreach (var (addOn, effectiveAddOnPrice) in addOnPrices)
            {
                var addOnItem = new OrderItem
                {
                    Id = Guid.NewGuid(),
                    OrderId = order.Id,
                    ProductId = addOn.ProductId,
                    Quantity = addOn.Quantity,
                    SpecialInstructions = addOn.SpecialInstructions,
                    Price = null,
                    SortOrder = 0,
                    ParentOrderItemId = newItem.Id,
                    BundlePromotionId = item.BundlePromotionId
                };

                // Capture price if order is Completed or Cancelled
                if (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled)
                {
                    addOnItem.Price = isOverride
                        && addOnPriceSnapshots.TryGetValue((item.ProductId, addOn.ProductId), out var paidAddOnPrice)
                            ? paidAddOnPrice
                            : effectiveAddOnPrice;
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
                oi.BundlePromotionId,
                oi.OriginalPrice,
                oi.PromoLabel
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

        var parentProductIds = orderWithTotals.OrderItems
            .Where(oi => oi.ParentOrderItemId == null)
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var addOnProductIds = orderWithTotals.OrderItems
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

        var totalAmount = OrderMetrics.ComputeOrderTotal(orderWithTotals, overridePrices);

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);
        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.OrderUpdated, order.Id, cancellationToken);

        if (oldStatus == OrderStatusEnum.Pending &&
            (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled))
        {
            var actorUserId = httpContextAccessor.HttpContext?.User.GetUserId() ?? Guid.Empty;
            await pushNotifications.SendOrderStatusChangedAsync(
                order,
                totalAmount,
                newStatus,
                actorUserId,
                cancellationToken);
        }

        if (isOverride)
        {
            await auditService.LogAsync(
                action: AuditAction.OrderOverridden,
                entityType: AuditEntityType.Order,
                entityId: order.Id.ToString(),
                oldValues: oldValues,
                newValues: new
                {
                    Reason = overrideReason,
                    Status = newStatus,
                    order.CustomerId,
                    PaymentMethod = order.PaymentMethodId.HasValue ? (PaymentMethodEnum)order.PaymentMethodId.Value : (PaymentMethodEnum?)null,
                    order.AmountReceived,
                    order.ChangeAmount,
                    order.Tips,
                    order.SpecialInstructions,
                    TotalAmount = totalAmount,
                    Items = items.Select(DescribeItem).ToList(),
                    BundlePromotions = bundlePromotions.Select(b => new { b.PromotionName, b.Quantity, b.UnitPrice }).ToList()
                },
                cancellationToken: cancellationToken);
        }
        else
        {
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
        }

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
            bundlePromotions,
            order.OverrideReason,
            order.OverriddenAt
        );
    }

    private static object DescribeItem(OrderItemDto item)
    {
        return new
        {
            Product = item.ProductName,
            item.Quantity,
            item.Price,
            AddOns = item.AddOns.Select(a => new { Product = a.ProductName, a.Quantity, a.Price }).ToList()
        };
    }

    /// <summary>What the order looked like before an override, for the audit log.</summary>
    private static object BuildOrderSnapshot(Order order)
    {
        var items = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null)
            .OrderBy(oi => oi.SortOrder)
            .Select(parent => new
            {
                Product = parent.Product.Name,
                parent.Quantity,
                parent.Price,
                AddOns = order.OrderItems
                    .Where(child => child.ParentOrderItemId == parent.Id)
                    .Select(child => new { Product = child.Product.Name, child.Quantity, child.Price })
                    .ToList()
            })
            .ToList();

        return new
        {
            Status = (OrderStatusEnum)order.StatusId,
            order.CustomerId,
            PaymentMethod = order.PaymentMethodId.HasValue ? (PaymentMethodEnum)order.PaymentMethodId.Value : (PaymentMethodEnum?)null,
            order.AmountReceived,
            order.ChangeAmount,
            order.Tips,
            order.SpecialInstructions,
            TotalAmount = OrderMetrics.ComputeOrderTotal(order, new Dictionary<(Guid ProductId, Guid AddOnId), decimal>()),
            Items = items,
            BundlePromotions = order.OrderBundlePromotions
                .Select(b => new { PromotionId = b.PromotionId, b.Quantity, b.UnitPrice })
                .ToList()
        };
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

    private sealed record DiscountedRule(
        decimal? FixedPrice,
        decimal? PercentOff,
        List<(Guid AddOnProductId, int Quantity)> RequiredAddOns);

    private sealed record AppliedDiscount(decimal Price, string? Label);

    private static AppliedDiscount? GetDiscountedUnitPrice(
        decimal basePrice,
        OrderItemRequestDto item,
        Dictionary<Guid, List<DiscountedRule>> rulesByProductId)
    {
        if (!rulesByProductId.TryGetValue(item.ProductId, out var rules) || rules.Count == 0)
        {
            return null;
        }

        var addOnMap = item.AddOns
            .GroupBy(x => x.ProductId)
            .ToDictionary(x => x.Key, x => x.Sum(y => y.Quantity));

        AppliedDiscount? best = null;
        foreach (var rule in rules)
        {
            if (!SatisfiesExactAddOns(addOnMap, rule.RequiredAddOns))
            {
                continue;
            }

            var discounted = CalculateDiscountedUnitPrice(basePrice, rule.FixedPrice, rule.PercentOff);
            if (!discounted.HasValue)
            {
                continue;
            }

            if (best is null || discounted.Value < best.Price)
            {
                best = new AppliedDiscount(
                    discounted.Value,
                    PromotionLabelFormatter.Format(rule.FixedPrice, rule.PercentOff));
            }
        }

        return best;
    }

    private static bool SatisfiesExactAddOns(
        Dictionary<Guid, int> addOnMap,
        IEnumerable<(Guid AddOnProductId, int Quantity)> requiredAddOns)
    {
        var required = requiredAddOns.ToList();
        if (required.Count == 0)
        {
            return false;
        }

        var requiredSet = required.Select(x => x.AddOnProductId).ToHashSet();
        foreach (var (addOnProductId, quantity) in required)
        {
            if (!addOnMap.TryGetValue(addOnProductId, out var qty) || qty != quantity)
            {
                return false;
            }
        }

        foreach (var entry in addOnMap)
        {
            if (!requiredSet.Contains(entry.Key) && entry.Value > 0)
            {
                return false;
            }
        }

        return true;
    }

    private static decimal? CalculateDiscountedUnitPrice(decimal basePrice, decimal? fixedPrice, decimal? percentOff)
    {
        if (fixedPrice.HasValue && fixedPrice.Value > 0)
        {
            var discounted = basePrice - fixedPrice.Value;
            return Math.Max(0, discounted);
        }

        if (percentOff.HasValue && percentOff.Value > 0)
        {
            var multiplier = 1m - (percentOff.Value / 100m);
            var discounted = basePrice * multiplier;
            return Math.Round(discounted, 2, MidpointRounding.AwayFromZero);
        }

        return null;
    }
}
