using WTF.Api.Features.Customers;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal static class OrderMapping
{
    public static List<OrderItemDto> ToItemDtos(
        IEnumerable<OrderItem> parentItems,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> overridePrices) =>
        [.. parentItems
            .OrderBy(oi => oi.SortOrder)
            .ThenBy(oi => oi.Id)
            .Select(oi => ToItemDto(oi, overridePrices))];

    public static OrderItemDto ToItemDto(
        OrderItem oi,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> overridePrices)
    {
        var addOns = oi.InverseParentOrderItem
            .OrderBy(child => child.SortOrder)
            .ThenBy(child => child.Id)
            .Select(child => new OrderItemDto(
                child.Id,
                child.ProductId,
                child.Product.Name,
                child.Quantity,
                child.Price ?? (overridePrices.TryGetValue((oi.ProductId, child.ProductId), out var overridePrice) ? overridePrice : child.Product.Price),
                [],
                child.SpecialInstructions,
                child.BundlePromotionId))
            .ToList();

        return new OrderItemDto(
            oi.Id,
            oi.ProductId,
            oi.Product.Name,
            oi.Quantity,
            oi.Price ?? oi.Product.Price,
            addOns,
            oi.SpecialInstructions,
            oi.BundlePromotionId,
            oi.OriginalPrice,
            oi.PromoLabel,
            oi.DiscountPromotionId,
            oi.SeniorPwdDiscountId,
            oi.SeniorPwdVatExempt,
            oi.SeniorPwdDiscount);
    }

    public static List<OrderBundlePromotionDto> ToBundleDtos(Order order) =>
        [.. order.OrderBundlePromotions
            .Select(obp => new OrderBundlePromotionDto(obp.PromotionId, obp.Promotion.Name, obp.Quantity, obp.UnitPrice))];

    public static OrderDto ToDto(
        Order order,
        List<OrderItemDto> items,
        decimal totalAmount,
        List<OrderBundlePromotionDto> bundlePromotions,
        IEnumerable<OrderSeniorPwdDiscount> seniorPwdRows,
        bool maskIds,
        bool includeCustomerName = false,
        List<string>? stockWarnings = null,
        List<Guid>? stockLineIds = null) =>
        new(
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
            includeCustomerName && order.Customer is not null ? CustomerName.Join(order.Customer.FirstName, order.Customer.LastName) : null,
            bundlePromotions,
            order.OverrideReason,
            order.OverriddenAt,
            (OrderSourceEnum)order.Source,
            order.FulfillmentType.HasValue ? (FulfillmentTypeEnum)order.FulfillmentType.Value : null,
            order.DeliveryAddress,
            order.ContactNumber,
            order.RejectionReason,
            order.AcceptedAt,
            order.ReadyAt,
            order.ReviewReasons,
            order.QuotedTotal,
            order.OfflineLocalId,
            stockWarnings,
            stockLineIds,
            SeniorPwdMapping.ToDtos(seniorPwdRows, maskIds),
            order.CustomerAddress,
            order.KitchenStatus);
}
