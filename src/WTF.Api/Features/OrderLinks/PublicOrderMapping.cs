using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.OrderLinks;

/// <summary>Turns orders into what the customer may see about them: no staff, user ids or audit data.</summary>
public static class PublicOrderMapping
{
    public const string Waiting = "waiting";
    public const string Accepted = "accepted";
    public const string Ready = "ready";
    public const string Completed = "completed";
    public const string Rejected = "rejected";
    public const string Cancelled = "cancelled";
    public const string Refunded = "refunded";

    /// <summary>The customer-facing status. A cancelled order that has a rejection reason was rejected by staff.</summary>
    public static (string Label, string Kind) StatusOf(
        int statusId, string? rejectionReason, DateTime? readyAt = null, byte? fulfillmentType = null)
    {
        return (OrderStatusEnum)statusId switch
        {
            OrderStatusEnum.PendingApproval => ("Waiting for confirmation", Waiting),
            OrderStatusEnum.Pending when readyAt.HasValue =>
                (fulfillmentType == (byte)FulfillmentTypeEnum.Delivery ? "Ready for delivery" : "Ready for pickup", Ready),
            OrderStatusEnum.Pending => ("Accepted", Accepted),
            OrderStatusEnum.Completed => ("Completed", Completed),
            OrderStatusEnum.Cancelled when !string.IsNullOrWhiteSpace(rejectionReason) => ("Rejected", Rejected),
            OrderStatusEnum.Cancelled => ("Cancelled", Cancelled),
            OrderStatusEnum.Refunded => ("Refunded", Refunded),
            _ => ("Processing", Accepted)
        };
    }

    /// <summary>Loads everything the mapping needs for these orders in one extra query and builds the DTOs.</summary>
    public static async Task<List<PublicOrderDto>> ToDtosAsync(
        WTFDbContext db, IReadOnlyList<Order> orders, CancellationToken cancellationToken)
    {
        // Orders that are not completed yet store no prices, so add-on prices come from the current overrides.
        var parentLinks = orders
            .SelectMany(o => o.OrderItems)
            .Where(oi => oi.ParentOrderItemId == null)
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();
        var addOnIds = orders
            .SelectMany(o => o.OrderItems)
            .Where(oi => oi.ParentOrderItemId != null)
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var overridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();
        if (addOnIds.Count > 0)
        {
            overridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => parentLinks.Contains(o.ProductId) && addOnIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        return [.. orders.Select(order => ToDto(order, overridePrices))];
    }

    private static PublicOrderDto ToDto(
        Order order, IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> overridePrices)
    {
        var (label, kind) = StatusOf(order.StatusId, order.RejectionReason, order.ReadyAt, order.FulfillmentType);

        var items = order.OrderItems
            .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
            .OrderBy(oi => oi.SortOrder)
            .ThenBy(oi => oi.Id)
            .Select(parent => new PublicOrderItemDto(
                parent.Product.Name,
                parent.Quantity,
                parent.Price ?? parent.Product.Price,
                [.. order.OrderItems
                    .Where(child => child.ParentOrderItemId == parent.Id && child.BundlePromotionId == null)
                    .OrderBy(child => child.SortOrder)
                    .ThenBy(child => child.Id)
                    .Select(child => new PublicOrderAddOnDto(
                        child.Product.Name,
                        child.Quantity,
                        child.Price
                            ?? (overridePrices.TryGetValue((parent.ProductId, child.ProductId), out var price)
                                ? price
                                : child.Product.Price)))],
                parent.SpecialInstructions))
            .ToList();

        return new PublicOrderDto(
            order.Id,
            order.OrderNumber,
            order.CreatedAt,
            label,
            kind,
            order.RejectionReason,
            items,
            OrderMetrics.ComputeOrderTotal(order, overridePrices),
            order.FulfillmentType.HasValue ? ((FulfillmentTypeEnum)order.FulfillmentType.Value).ToString() : null,
            order.DeliveryAddress,
            order.ContactNumber,
            order.PaymentMethodId.HasValue ? ((PaymentMethodEnum)order.PaymentMethodId.Value).ToString() : null,
            order.AmountReceived,
            order.Tips,
            order.SpecialInstructions,
            order.AcceptedAt,
            order.ReadyAt,
            IsFinished(order.StatusId) ? order.UpdatedAt : null);
    }

    /// <summary>Completed, rejected, cancelled and refunded orders end at their last update.</summary>
    private static bool IsFinished(int statusId) => (OrderStatusEnum)statusId is
        OrderStatusEnum.Completed or OrderStatusEnum.Cancelled or OrderStatusEnum.Refunded;
}
