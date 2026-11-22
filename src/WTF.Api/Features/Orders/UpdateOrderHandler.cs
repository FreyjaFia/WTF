using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Common.Time;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Kitchen;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Calculations.Kitchen;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record UpdateOrderCommand : IRequest<OrderDto?>
{
    [Required]
    public Guid Id { get; init; }

    /// <summary>The customer, or null for a walk-in order.</summary>
    public Guid? CustomerId { get; init; }

    [Required]
    public List<OrderItemRequestDto> Items { get; init; } = [];
    public List<OrderBundlePromotionRequestDto> BundlePromotions { get; init; } = [];
    public List<SeniorPwdPersonRequestDto> SeniorPwdPersons { get; init; } = [];
    public string? SpecialInstructions { get; init; }
    public string? Note { get; init; }

    // Applied while the order is not completed and by the override; a completed order keeps its address otherwise.
    public string? CustomerAddress { get; init; }

    [Required]
    public OrderStatusEnum Status { get; init; }

    public PaymentMethodEnum? PaymentMethod { get; init; }

    public decimal? AmountReceived { get; init; }

    public decimal? ChangeAmount { get; init; }

    public decimal? Tips { get; init; }

    // The total the register showed and collected against; see CreateOrderCommand.ExpectedTotal.
    public decimal? ExpectedTotal { get; init; }

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
    IPushNotificationService pushNotifications,
    IConversationNotifier conversationNotifier,
    IOrderStockService stockService,
    ITenantFeatures tenantFeatures) : IRequestHandler<UpdateOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(UpdateOrderCommand request, CancellationToken cancellationToken)
    {
        using var gate = await PromotionLimitGate.EnterAsync(db.StampTenantId, cancellationToken);

        var order = await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Include(o => o.OrderSeniorPwdDiscounts)
            .FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);

        if (order is null)
        {
            return null;
        }

        OrderInputValidation.EnsureQuantities(request.Items);

        // Validate no nested add-ons and add-on type rules
        foreach (var item in request.Items)
        {
            if (item.AddOns.Any(addOn => addOn.AddOns?.Count > 0))
            {
                throw new InvalidOperationException("Nested add-ons are not allowed. Add-ons cannot have their own add-ons.");
            }

            await AddOnTypeRuleCheck.EnsureAsync(db, item.ProductId, item.AddOns, cancellationToken);
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

        // An Admin correcting a completed order may keep a product that was deleted after the sale; only new ones are refused.
        var productsAlreadyOnOrder = request.IsOverride
            ? order.OrderItems.Select(oi => oi.ProductId).ToHashSet()
            : [];

        var inactiveProductNames = activeProductMap.Values
            .Where(p => !p.IsActive && !productsAlreadyOnOrder.Contains(p.Id))
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

        var bundlePriceByPromotionId = await BundlePromotionResolver.ResolveAsync(
            db,
            request.BundlePromotions,
            request.Items,
            DateTime.UtcNow,
            RequestTimeZone.ResolveFromRequest(httpContextAccessor),
            request.IsOverride ? order.OrderBundlePromotions.ToDictionary(b => b.PromotionId, b => b.UnitPrice) : null,
            cancellationToken,
            exceptOrderId: order.Id,
            tenantFeatures: tenantFeatures);

        OrderInputValidation.EnsureLengths(
            request.SpecialInstructions, request.Note?.Trim(), request.Items, request.OverrideReason?.Trim());

        // Keeping the customer an order already has is always fine, even if they were deactivated since.
        if (request.CustomerId != order.CustomerId)
        {
            await OrderInputValidation.EnsureCustomerAsync(db, request.CustomerId, cancellationToken);
        }

        var oldStatus = (OrderStatusEnum)order.StatusId;
        var newStatus = request.Status;

        if (newStatus == OrderStatusEnum.PendingApproval)
        {
            throw new InvalidOperationException("An order cannot be set to waiting for approval.");
        }

        if (newStatus == OrderStatusEnum.PendingReview)
        {
            throw new InvalidOperationException("An order cannot be set to waiting for review.");
        }

        if (oldStatus == OrderStatusEnum.PendingReview)
        {
            throw new InvalidOperationException("This order is waiting for an Admin to review it. Approve or reject it first.");
        }

        if (oldStatus == OrderStatusEnum.PendingApproval)
        {
            throw new InvalidOperationException("This order is waiting for approval. Accept or reject it first.");
        }

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

        var actorUserId = httpContextAccessor.HttpContext?.User.GetUserId() ?? order.CreatedBy;

        if (order.OrderSeniorPwdDiscounts.Count > 0
            && request.SeniorPwdPersons.Count == 0
            && !PermissionChecks.Has(httpContextAccessor.HttpContext?.User, PermissionKeys.OrdersSeniorPwdApply))
        {
            throw new ForbiddenActionException("You are not allowed to remove the Senior/PWD discount.");
        }

        var seniorPwd = await SeniorPwdOrders.LoadAsync(
            db,
            httpContextAccessor,
            request.SeniorPwdPersons,
            request.Items,
            false,
            order.Source == (byte)OrderSourceEnum.CustomerLink,
            isOverride && order.OrderSeniorPwdDiscounts.Count > 0,
            cancellationToken);

        var shouldCapturePrice = newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled;
        // An order that stays pending saves no price yet, but it holds the use of a limited discount while it waits.
        var reservesDiscount = !isOverride && newStatus == OrderStatusEnum.Pending;
        Dictionary<Guid, List<PromotionPricing.DiscountedRule>> discountedRulesByProductId = [];
        DiscountBudget? discountBudget = null;
        if (shouldCapturePrice || reservesDiscount)
        {
            var loaded = await DiscountRuleLoader.LoadAsync(
                db,
                DateTime.UtcNow,
                RequestTimeZone.ResolveFromRequest(httpContextAccessor),
                order.Id,
                cancellationToken,
                tenantFeatures);
            discountedRulesByProductId = loaded.RulesByProductId;

            // Correcting a completed order never takes a use away from, or adds one to, a promotion's limit.
            discountBudget = isOverride ? null : loaded.Budget;
        }

        // Prices are the branch's own where it sets one. An order keeps the branch it was made in.
        var branchPrices = await BranchPriceLookup.ForBranchAsync(db, tenantFeatures, order.BranchId, null, cancellationToken);
        decimal ListPriceOf(Product p) => BranchPriceLookup.PriceFor(branchPrices, p.Id, p.Price);

        var pricedItems = new List<(
            OrderItemRequestDto Item,
            Product Product,
            decimal? DiscountedPrice,
            PromotionPricing.AppliedDiscount? AppliedDiscount,
            List<(OrderItemRequestDto AddOn, decimal Price)> AddOnPrices)>();

        var coveredAmounts = new Dictionary<int, SeniorPwdAmounts>();
        for (var itemIndex = 0; itemIndex < request.Items.Count; itemIndex++)
        {
            var item = request.Items[itemIndex];
            var product = await db.Products.FindAsync([item.ProductId], cancellationToken) ?? throw new InvalidOperationException($"Product with ID {item.ProductId} not found.");
            var basePrice = ListPriceOf(product);
            // A line inside a bundle is sold at the bundle's price, so no discount applies to it.
            var appliedDiscount = (shouldCapturePrice || reservesDiscount) && !item.BundlePromotionId.HasValue
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
            if (seniorPwd is not null && item.SeniorPwdPersonIndex.HasValue)
            {
                // A correction keeps the price paid, so a promotion is judged on the saved line (CoverLine).
                seniorPwd.EnsureLineAllowed(product.Name, product.IsSeniorPwdEligible, !isOverride && appliedDiscount is not null, item.BundlePromotionId.HasValue);
            }

            var addOnPrices = new List<(OrderItemRequestDto AddOn, decimal Price)>();
            foreach (var addOn in item.AddOns)
            {
                var addOnProduct = await db.Products.FindAsync([addOn.ProductId], cancellationToken)
                    ?? throw new InvalidOperationException($"Add-on product with ID {addOn.ProductId} not found.");
                var addOnOverridePrice = await db.ProductAddOnPriceOverrides
                    .Where(o => o.ProductId == item.ProductId && o.AddOnId == addOn.ProductId && o.IsActive)
                    .Select(o => (decimal?)o.Price)
                    .FirstOrDefaultAsync(cancellationToken);
                addOnPrices.Add((addOn, addOnOverridePrice ?? ListPriceOf(addOnProduct)));
            }

            var finalUnitPrice = (discountedPrice ?? basePrice)
                + addOnPrices.Sum(addOn => addOn.Price * addOn.AddOn.Quantity);
            if (!item.BundlePromotionId.HasValue && finalUnitPrice < 0)
            {
                throw new InvalidOperationException($"The final unit price for '{product.Name}' cannot be negative.");
            }

            if (seniorPwd is not null && item.SeniorPwdPersonIndex.HasValue && !isOverride)
            {
                coveredAmounts[itemIndex] = seniorPwd.AmountsFor(
                    basePrice, addOnPrices.Sum(a => a.Price * a.AddOn.Quantity), item.Quantity);
            }

            pricedItems.Add((item, product, discountedPrice, appliedDiscount, addOnPrices));
        }

        if (!isOverride && newStatus == OrderStatusEnum.Completed)
        {
            var linesTotal = pricedItems
                .Where(p => !p.Item.BundlePromotionId.HasValue)
                .Sum(p => OrderMetrics.LineTotal(
                    ListPriceOf(p.Product),
                    p.DiscountedPrice ?? ListPriceOf(p.Product),
                    p.AppliedDiscount?.DiscountedQuantity ?? 0,
                    p.AddOnPrices.Sum(a => a.Price * a.AddOn.Quantity),
                    p.Item.Quantity));
            var bundlesTotal = OrderMetrics.BundlesTotal(
                request.BundlePromotions.Select(b => (bundlePriceByPromotionId[b.PromotionId], b.Quantity)));
            var serverTotal = OrderMetrics.ExpectedTotal(linesTotal, bundlesTotal, coveredAmounts.Values.Sum(amounts => amounts.Reduction));

            OrderTotalCheck.EnsureUnchanged(request.ExpectedTotal, serverTotal);
        }

        object oldValues = new
        {
            Status = oldStatus,
            order.CustomerId,
            order.CustomerAddress,
            ItemCount = order.OrderItems.Count
        };

        // An override keeps the prices the customer already paid for lines that are still on the
        // order (same product and bundle), so later promo changes do not reprice them.
        var priceSnapshots = new Dictionary<(Guid ProductId, Guid? BundleId), Queue<(decimal? Price, decimal? OriginalPrice, string? PromoLabel, Guid? DiscountPromotionId)>>();
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
                    queue = new Queue<(decimal?, decimal?, string?, Guid?)>();
                    priceSnapshots[key] = queue;
                }

                queue.Enqueue((parent.Price, parent.OriginalPrice, parent.PromoLabel, parent.DiscountPromotionId));

                foreach (var child in order.OrderItems.Where(oi => oi.ParentOrderItemId == parent.Id && oi.Price.HasValue))
                {
                    addOnPriceSnapshots.TryAdd((parent.ProductId, child.ProductId), child.Price!.Value);
                }
            }
        }

        var customerChanged = request.CustomerId != order.CustomerId;
        order.CustomerId = request.CustomerId;
        if (isOverride || oldStatus != OrderStatusEnum.Completed)
        {
            // A request that leaves the address out keeps the one on the order; a new customer brings their saved one.
            order.CustomerAddress = request.CustomerAddress is null && !customerChanged && request.CustomerId.HasValue
                ? order.CustomerAddress
                : await OrderInputValidation.ResolveCustomerAddressAsync(
                    db, request.CustomerId, request.CustomerAddress, cancellationToken);
        }

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
            order.UpdatedBy = actorUserId;
            order.OverrideReason = overrideReason;
            order.OverriddenAt = order.UpdatedAt;
        }

        // The order lines are rebuilt and the stock follows them, so both succeed or fail together.
        await using var ownTransaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        // The kitchen compares what it was given with what the order holds now, before the lines are replaced.
        if (order.KitchenStatus is { } kitchenState)
        {
            var names = activeProductMap.ToDictionary(p => p.Key, p => p.Value.Name);
            var diff = KitchenBoardRules.Diff(
                KitchenLineKeys.FromOrderItems(order.OrderItems),
                KitchenLineKeys.FromRequest(request.Items, names));
            var outcome = KitchenBoardRules.AfterEdit((KitchenState)kitchenState, diff);
            if (outcome.Kind != KitchenChangeKind.None)
            {
                order.KitchenChangeKind = (byte)outcome.Kind;
                order.KitchenChangeNote = outcome.Note;
                order.KitchenChangedAt = order.UpdatedAt;
                if (outcome.NewState is { } movedTo)
                {
                    order.KitchenStatus = (byte)movedTo;
                    order.ReadyAt = movedTo < KitchenState.Ready ? null : order.ReadyAt;
                    order.KitchenServedAt = null;
                    order.KitchenStartedAt = movedTo >= KitchenState.Preparing ? order.KitchenStartedAt : null;
                }
            }
        }

        // Update items: remove old, add new
        var seniorPwdBefore = SeniorPwdAudit.Snapshot(order.OrderSeniorPwdDiscounts);
        db.OrderItems.RemoveRange(order.OrderItems);
        db.OrderBundlePromotions.RemoveRange(order.OrderBundlePromotions);
        var seniorPwdRemoved = seniorPwd?.CreateRows(order.Id, actorUserId, order.CreatedAt, order.OrderSeniorPwdDiscounts)
            ?? order.OrderSeniorPwdDiscounts.ToList();
        db.OrderSeniorPwdDiscounts.RemoveRange(seniorPwdRemoved);

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

        var sortOrder = 0;
        for (var itemIndex = 0; itemIndex < pricedItems.Count; itemIndex++)
        {
            var (item, product, discountedPrice, appliedDiscount, addOnPrices) = pricedItems[itemIndex];
            // A limit can cover only part of a line (the uses left, or the most one order may have): the discounted
            // items and the rest become two lines, the rest at full price.
            (int Quantity, bool Discounted)[] segments = appliedDiscount is { IsPartial: true }
                ? [(appliedDiscount.DiscountedQuantity, true), (item.Quantity - appliedDiscount.DiscountedQuantity, false)]
                : [(item.Quantity, appliedDiscount is not null)];

            foreach (var segment in segments)
            {
                var newItem = new OrderItem
                {
                    Id = Guid.NewGuid(),
                    OrderId = order.Id,
                    ProductId = item.ProductId,
                    Quantity = segment.Quantity,
                    SpecialInstructions = item.SpecialInstructions,
                    Price = null,
                    SortOrder = sortOrder++,
                    ParentOrderItemId = null,
                    BundlePromotionId = item.BundlePromotionId
                };

                // Capture price snapshot when order is Completed or Cancelled
                if (shouldCapturePrice)
                {
                    newItem.Price = segment.Discounted ? discountedPrice ?? ListPriceOf(product) : ListPriceOf(product);
                    newItem.OriginalPrice = ListPriceOf(product);
                    newItem.PromoLabel = segment.Discounted
                        ? appliedDiscount?.LabelWith(addOnPrices.Sum(addOn => addOn.Price * addOn.AddOn.Quantity))
                        : null;
                    newItem.DiscountPromotionId = segment.Discounted ? appliedDiscount?.PromotionId : null;

                    if (isOverride
                        && priceSnapshots.TryGetValue((item.ProductId, item.BundlePromotionId), out var snapshots)
                        && snapshots.Count > 0)
                    {
                        var snapshot = snapshots.Dequeue();
                        newItem.Price = snapshot.Price ?? newItem.Price;
                        newItem.OriginalPrice = snapshot.OriginalPrice;
                        newItem.PromoLabel = snapshot.PromoLabel;
                        newItem.DiscountPromotionId = snapshot.DiscountPromotionId;
                    }
                }
                else if (reservesDiscount)
                {
                    newItem.DiscountPromotionId = segment.Discounted ? appliedDiscount?.PromotionId : null;
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

                if (seniorPwd is not null && item.SeniorPwdPersonIndex.HasValue)
                {
                    var amounts = coveredAmounts.TryGetValue(itemIndex, out var checkedAmounts)
                        ? checkedAmounts
                        : seniorPwd.AmountsFor(
                            newItem.Price ?? ListPriceOf(product),
                            addOnPrices.Sum(addOn => addOn.AddOn.Quantity
                                * (addOnPriceSnapshots.TryGetValue((item.ProductId, addOn.AddOn.ProductId), out var paid)
                                    ? paid
                                    : addOn.Price)),
                            segment.Quantity);
                    seniorPwd.CoverLine(item, product, newItem, amounts);
                }
            }
        }

        seniorPwd?.EnsureEveryPersonCovered();
        seniorPwd?.Complete(db);

        var statusLine = newStatus != oldStatus ? OrderChatLines.For(newStatus) : null;
        var chat = statusLine == null
            ? null
            : await ConversationStore.AddSystemMessageAsync(
                db, order, statusLine, actorUserId, order.UpdatedAt!.Value,
                cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        // A sale takes stock when the order becomes completed; a correction moves only the difference.
        var stock = newStatus == OrderStatusEnum.Completed
            ? await stockService.DeductForOrderAsync(
                order.Id,
                actorUserId,
                new StockDeductionOptions(IsCorrection: isOverride),
                cancellationToken)
            : StockDeductionResult.None;

        if (ownTransaction is not null)
        {
            await ownTransaction.CommitAsync(cancellationToken);
        }

        gate.Dispose();
        await conversationNotifier.OrderChangedAsync(order, chat, cancellationToken);

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
                oi.DiscountPromotionId,
                oi.SeniorPwdDiscountId,
                oi.SeniorPwdVatExempt,
                oi.SeniorPwdDiscount
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
        var previewPrices = await PendingOrderPreview.LoadAsync(db, [orderWithTotals], httpContextAccessor, cancellationToken, tenantFeatures);

        var totalAmount = OrderMetrics.ComputeOrderTotal(orderWithTotals, overridePrices, previewPrices);

        // Cash: the cashier gives back the cash minus the total and the tip, so the change is worked out here instead of
        // trusted from the app (an order queued offline by an older version used the total alone).
        if (order.AmountReceived.HasValue)
        {
            order.ChangeAmount = CashPayment.ChangeToGive(order.AmountReceived.Value, totalAmount, order.Tips);
            await db.SaveChangesAsync(cancellationToken);
        }

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers(db.StampTenantId, order.BranchId))
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);
        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers(db.StampTenantId, order.BranchId))
            .SendAsync(HubNames.Events.OrderUpdated, order.Id, cancellationToken);

        if (isOverride ||
            (oldStatus == OrderStatusEnum.Pending &&
                (newStatus == OrderStatusEnum.Completed || newStatus == OrderStatusEnum.Cancelled)))
        {
            await pushNotifications.SendOrderStatusChangedAsync(
                order,
                totalAmount,
                newStatus,
                actorUserId,
                cancellationToken,
                isOverride);
        }

        await SeniorPwdAudit.LogChangesAsync(
            auditService,
            order,
            seniorPwdBefore,
            seniorPwd?.Rows ?? [],
            actorUserId,
            cancellationToken);

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
                    order.CustomerAddress,
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

        return OrderMapping.ToDto(
            order,
            items,
            totalAmount,
            bundlePromotions,
            seniorPwd?.Rows ?? [],
            maskIds: !SeniorPwdMapping.CanSeeFullId(httpContextAccessor),
            stockWarnings: stock.Warnings);
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
            order.CustomerAddress,
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
}
