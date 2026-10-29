using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record CreateOrderCommand : IRequest<OrderDto>
{
    /// <summary>The customer, or null for a walk-in order.</summary>
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

    // The POS queue number of an order sold offline. The server uses it to recognize an order it already saved.
    public string? OfflineLocalId { get; init; }

    // The total the register showed and collected against. When it is set and the server works out another total (a price or a
    // promotion moved meanwhile), a finished sale is refused so the cashier can review it.
    public decimal? ExpectedTotal { get; init; }

    // True when the caller already holds the promotion gate (offline sync, batch, customer submit).
    [JsonIgnore]
    public bool GateHeld { get; init; }

    // The fields below are set by the server only (for orders placed through a customer ordering link). They are never
    // read from a request body, so a signed-in caller cannot claim another user, a source or a link.

    /// <summary>The user the order is created for. Null means the signed-in user of the current request.</summary>
    [JsonIgnore]
    public Guid? ActorUserId { get; init; }

    [JsonIgnore]
    public OrderSourceEnum Source { get; init; } = OrderSourceEnum.Pos;

    [JsonIgnore]
    public Guid? OrderLinkId { get; init; }

    [JsonIgnore]
    public FulfillmentTypeEnum? FulfillmentType { get; init; }

    [JsonIgnore]
    public string? DeliveryAddress { get; init; }

    [JsonIgnore]
    public string? ContactNumber { get; init; }

    // Why an offline order is held for an Admin. Set by the sync handler only; never read from a request body.
    [JsonIgnore]
    public IReadOnlyList<string>? HeldReasons { get; init; }

    // A sale that already happened (offline sync, batch) is never refused for stock: the balance may go below zero.
    [JsonIgnore]
    public bool HonorStock { get; init; }
}

public class CreateOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IPushNotificationService pushNotifications,
    IConversationNotifier conversationNotifier,
    IOrderStockService stockService) : IRequestHandler<CreateOrderCommand, OrderDto>
{
    public async Task<OrderDto> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        using var gate = request.GateHeld ? null : await PromotionLimitGate.EnterAsync(cancellationToken);

        var userId = request.ActorUserId ?? httpContextAccessor.HttpContext!.User.GetUserId();
        var held = request.HeldReasons is { Count: > 0 };

        // Orders waiting for approval only come from a customer's ordering link; staff cannot create one.
        if (request.Status == OrderStatusEnum.PendingApproval && request.Source != OrderSourceEnum.CustomerLink)
        {
            throw new InvalidOperationException("An order cannot be created as waiting for approval.");
        }

        if (request.Status == OrderStatusEnum.PendingReview)
        {
            throw new InvalidOperationException("An order cannot be created as waiting for review.");
        }

        if (request.Items.Count == 0 && request.BundlePromotions.Count == 0)
        {
            throw new InvalidOperationException("An order must contain at least one item.");
        }

        OrderInputValidation.EnsureLengths(request.SpecialInstructions, request.Note?.Trim(), request.Items);
        if (held)
        {
            if (request.CustomerId.HasValue && !await db.Customers.AnyAsync(c => c.Id == request.CustomerId.Value, cancellationToken))
            {
                throw new InvalidOperationException("The customer was not found.");
            }
        }
        else
        {
            await OrderInputValidation.EnsureCustomerAsync(db, request.CustomerId, cancellationToken);
        }

        // Validate no nested add-ons and add-on type rules
        foreach (var item in request.Items)
        {
            if (item.Quantity <= 0)
            {
                throw new InvalidOperationException("Item quantity must be greater than zero.");
            }

            if (item.AddOns.Any(addOn => addOn.Quantity <= 0))
            {
                throw new InvalidOperationException("Add-on quantity must be greater than zero.");
            }

            if (item.AddOns.Any(addOn => addOn.AddOns?.Count > 0))
            {
                throw new InvalidOperationException("Nested add-ons are not allowed. Add-ons cannot have their own add-ons.");
            }

            // A held order records what was sold at the till: the catalog rules below may have changed since.
            if (held)
            {
                continue;
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

            PickOneAddOnRule.Ensure(item.AddOns, productAddOns.Select(pa => (pa.AddOnId, pa.AddOnType)));

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

        if (inactiveProductNames.Count > 0 && !held)
        {
            throw new InvalidOperationException(
                $"Cannot save order with inactive products/add-ons: {string.Join(", ", inactiveProductNames)}.");
        }

        if (activeProductMap.Count != requestedProductIds.Count)
        {
            throw new InvalidOperationException("One or more selected products/add-ons were not found.");
        }

        var bundlePriceByPromotionId = held
            ? await BundlePromotionResolver.ResolveHeldAsync(db, request.BundlePromotions, request.Items, cancellationToken)
            : await BundlePromotionResolver.ResolveAsync(
                db,
                request.BundlePromotions,
                request.Items,
                request.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow,
                RequestTimeZone.ResolveFromRequest(httpContextAccessor),
                null,
                cancellationToken);

        // Several orders can be created inside one transaction (the offline sync batch opens it around them all so
        // a failed order undoes the ones before it). SQL Server does not allow a second transaction on a connection
        // that already has one, so join the one that is open and leave committing it to whoever started it.
        await using var ownTransaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var order = new Order
        {
            CreatedAt = createdAt,
            CreatedBy = userId,
            CustomerId = request.CustomerId,
            SpecialInstructions = request.SpecialInstructions,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            StatusId = held ? (int)OrderStatusEnum.PendingReview : (int)request.Status,
            PaymentMethodId = request.PaymentMethod.HasValue ? (int)request.PaymentMethod.Value : null,
            AmountReceived = request.AmountReceived,
            ChangeAmount = request.ChangeAmount,
            Tips = request.Tips,
            Source = (byte)request.Source,
            OrderLinkId = request.OrderLinkId,
            FulfillmentType = request.FulfillmentType.HasValue ? (byte)request.FulfillmentType.Value : null,
            DeliveryAddress = request.DeliveryAddress,
            ContactNumber = request.ContactNumber,
            OfflineLocalId = request.OfflineLocalId,
            ReviewReasons = held ? OfflineOrderReview.JoinReasons(request.HeldReasons!) : null
        };

        db.Orders.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        if (request.BundlePromotions.Count > 0)
        {
            var orderBundlePromotions = request.BundlePromotions.Select(bundle => new OrderBundlePromotion
            {
                OrderId = order.Id,
                PromotionId = bundle.PromotionId,
                Quantity = bundle.Quantity,
                UnitPrice = bundlePriceByPromotionId[bundle.PromotionId]
            });

            db.OrderBundlePromotions.AddRange(orderBundlePromotions);
        }

        var shouldCapturePrice = held || request.Status == OrderStatusEnum.Completed || request.Status == OrderStatusEnum.Cancelled;
        // A pending or waiting order saves no price yet, but it holds the use of a limited discount from the moment it is saved.
        var reservesDiscount = !held && request.Status is OrderStatusEnum.Pending or OrderStatusEnum.PendingApproval;
        Dictionary<Guid, List<PromotionPricing.DiscountedRule>> discountedRulesByProductId = [];
        DiscountBudget? discountBudget = null;
        if ((shouldCapturePrice || reservesDiscount) && !held)
        {
            var loaded = await DiscountRuleLoader.LoadAsync(
                db,
                request.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow,
                RequestTimeZone.ResolveFromRequest(httpContextAccessor),
                null,
                cancellationToken);
            discountedRulesByProductId = loaded.RulesByProductId;
            discountBudget = loaded.Budget;
        }

        // Add order items with parent-child relationships
        var sortOrder = 0;
        for (var itemIndex = 0; itemIndex < request.Items.Count; itemIndex++)
        {
            var item = request.Items[itemIndex];
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            var basePrice = product.Price;
            // A line inside a bundle is sold at the bundle's price, so no discount applies to it.
            var appliedDiscount = (shouldCapturePrice || reservesDiscount) && !held && !item.BundlePromotionId.HasValue
                ? PromotionPricing.GetDiscountedUnitPrice(
                    basePrice,
                    item.ProductId,
                    item.AddOns.Select(a => (a.ProductId, a.Quantity)),
                    discountedRulesByProductId,
                    item.Quantity,
                    discountBudget)
                : null;
            discountBudget?.Use(appliedDiscount?.PromotionId, appliedDiscount?.DiscountedQuantity ?? 0);
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
                addOnPrices.Add((addOn, held
                    ? OfflineOrderReview.QuotedPriceOrThrow(addOn.QuotedPrice, addOnProduct.Name)
                    : addOnOverridePrice ?? addOnProduct.Price));
            }

            var finalUnitPrice = (discountedPrice ?? basePrice)
                + addOnPrices.Sum(addOn => addOn.Price * addOn.AddOn.Quantity);
            if (!held && !item.BundlePromotionId.HasValue && finalUnitPrice < 0)
            {
                throw new InvalidOperationException($"The final unit price for '{product.Name}' cannot be negative.");
            }

            // A limit can cover only part of a line (the uses left, or the most one order may have): the discounted
            // items and the rest become two lines, the rest at full price.
            (int Quantity, bool Discounted)[] segments = appliedDiscount is { IsPartial: true }
                ? [(appliedDiscount.DiscountedQuantity, true), (item.Quantity - appliedDiscount.DiscountedQuantity, false)]
                : [(item.Quantity, appliedDiscount is not null)];

            foreach (var segment in segments)
            {
                var orderItem = new OrderItem
                {
                    OrderId = order.Id,
                    ProductId = item.ProductId,
                    Quantity = segment.Quantity,
                    SpecialInstructions = item.SpecialInstructions,
                    Price = null,
                    SortOrder = sortOrder++,
                    ParentOrderItemId = null,
                    BundlePromotionId = item.BundlePromotionId
                };

                // Capture price if order is Completed or Cancelled. A held order keeps the prices it was quoted offline.
                if (held)
                {
                    var quoted = item.BundlePromotionId.HasValue
                        ? item.QuotedPrice ?? basePrice
                        : OfflineOrderReview.QuotedPriceOrThrow(item.QuotedPrice, product.Name);
                    orderItem.Price = quoted;
                    orderItem.OriginalPrice = item.QuotedOriginalPrice ?? quoted;
                    orderItem.PromoLabel = item.QuotedPromoLabel;
                }
                else if (shouldCapturePrice)
                {
                    orderItem.Price = segment.Discounted ? discountedPrice ?? basePrice : basePrice;
                    orderItem.OriginalPrice = basePrice;
                    orderItem.PromoLabel = segment.Discounted
                        ? appliedDiscount?.LabelWith(addOnPrices.Sum(addOn => addOn.Price * addOn.AddOn.Quantity))
                        : null;
                    orderItem.DiscountPromotionId = segment.Discounted ? appliedDiscount?.PromotionId : null;
                }
                else if (reservesDiscount)
                {
                    orderItem.DiscountPromotionId = segment.Discounted ? appliedDiscount?.PromotionId : null;
                }

                db.OrderItems.Add(orderItem);
                await db.SaveChangesAsync(cancellationToken);

                // Add child items (add-ons)
                foreach (var (addOn, effectiveAddOnPrice) in addOnPrices)
                {
                    var addOnOrderItem = new OrderItem
                    {
                        OrderId = order.Id,
                        ProductId = addOn.ProductId,
                        Quantity = addOn.Quantity,
                        SpecialInstructions = addOn.SpecialInstructions,
                        Price = null,
                        SortOrder = 0,
                        ParentOrderItemId = orderItem.Id,
                        BundlePromotionId = item.BundlePromotionId
                    };

                    // Capture price if order is Completed or Cancelled
                    if (shouldCapturePrice)
                    {
                        addOnOrderItem.Price = effectiveAddOnPrice;
                    }

                    db.OrderItems.Add(addOnOrderItem);
                }
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        // Get items with hierarchy
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
                oi.PromoLabel,
                oi.DiscountPromotionId
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

        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(db, [orderWithTotals], cancellationToken);

        // A pending order saves no prices yet, so its total (and the change worked out from it) uses the discounts that are on.
        var previewPrices = await PendingOrderPreview.LoadAsync(db, [orderWithTotals], httpContextAccessor, cancellationToken);

        var totalAmount = OrderMetrics.ComputeOrderTotal(orderWithTotals, overridePrices, previewPrices);

        if (!held && request.Status == OrderStatusEnum.Completed)
        {
            OrderTotalCheck.EnsureUnchanged(request.ExpectedTotal, totalAmount);

            // Tips are ignored here: an order queued offline by an older app took the tip outside the cash it recorded.
            if (request.PaymentMethod == PaymentMethodEnum.Cash
                && request.AmountReceived.HasValue
                && CashPayment.Change(request.AmountReceived.Value, totalAmount, null) < 0m)
            {
                throw new InvalidOperationException("The cash received is less than the order total.");
            }
        }

        if (held)
        {
            order.QuotedTotal = totalAmount;
            await db.SaveChangesAsync(cancellationToken);
        }

        // Cash: the cashier gives back the cash minus the total and the tip, so the change is worked out here instead of
        // trusted from the app (an order queued offline by an older version used the total alone).
        if (order.AmountReceived.HasValue)
        {
            order.ChangeAmount = CashPayment.ChangeToGive(order.AmountReceived.Value, totalAmount, order.Tips);
            await db.SaveChangesAsync(cancellationToken);
        }

        // Stock leaves the shelf when a sale is made. A held offline sale waits for its approval; open orders take nothing yet.
        var stock = !held && request.Status == OrderStatusEnum.Completed
            ? await stockService.DeductForOrderAsync(
                order.Id,
                userId,
                new StockDeductionOptions(BlockWhenShort: !request.HonorStock),
                cancellationToken)
            : StockDeductionResult.None;

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);
        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.OrderUpdated, order.Id, cancellationToken);
        // Staff without the dashboard permission watch the orders list through the orders hub.
        await conversationNotifier.OrderChangedAsync(order, null, cancellationToken);

        await auditService.LogAsync(
            action: held ? AuditAction.OrderHeldForReview : AuditAction.OrderCreated,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            newValues: new
            {
                order.OrderNumber,
                order.StatusId,
                order.CustomerId,
                Source = request.Source.ToString(),
                ItemCount = items.Count,
                totalAmount,
                Reasons = request.HeldReasons
            },
            userId: userId,
            cancellationToken: cancellationToken);

        if (ownTransaction is not null)
        {
            await ownTransaction.CommitAsync(cancellationToken);
        }

        gate?.Dispose();

        if (request.Source == OrderSourceEnum.CustomerLink)
        {
            var customerName = await db.Customers
                .Where(c => c.Id == order.CustomerId)
                .Select(c => c.FirstName + " " + c.LastName)
                .FirstOrDefaultAsync(cancellationToken);

            await pushNotifications.SendLinkOrderCreatedAsync(
                order, totalAmount, customerName, request.FulfillmentType, cancellationToken);
        }
        else
        {
            if (request.Source == OrderSourceEnum.CustomerLink)
            {
                var customerName = await db.Customers
                    .Where(c => c.Id == order.CustomerId)
                    .Select(c => c.FirstName + " " + c.LastName)
                    .FirstOrDefaultAsync(cancellationToken);

                await pushNotifications.SendLinkOrderCreatedAsync(
                    order, totalAmount, customerName, request.FulfillmentType, cancellationToken);
            }
            else
            {
                if (!held)
                {
                    await pushNotifications.SendOrderCreatedAsync(order, totalAmount, userId, cancellationToken);
                }
            }
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
            Source: request.Source,
            FulfillmentType: request.FulfillmentType,
            DeliveryAddress: request.DeliveryAddress,
            ContactNumber: request.ContactNumber,
            ReviewReasons: order.ReviewReasons,
            QuotedTotal: order.QuotedTotal,
            OfflineLocalId: order.OfflineLocalId,
            StockWarnings: stock.Warnings
        );
    }
}
