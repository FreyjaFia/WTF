using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Orders.DTOs;

public record OrderDto(
    Guid Id, int OrderNumber, DateTime CreatedAt, Guid CreatedBy, DateTime? UpdatedAt, Guid? UpdatedBy,
    List<OrderItemDto> Items, Guid? CustomerId, OrderStatusEnum Status, PaymentMethodEnum? PaymentMethod,
    decimal? AmountReceived, decimal? ChangeAmount, decimal? Tips, string? SpecialInstructions, string? Note, decimal TotalAmount,
    string? CustomerName = null,
    List<OrderBundlePromotionDto>? BundlePromotions = null,
    string? OverrideReason = null,
    DateTime? OverriddenAt = null,
    OrderSourceEnum Source = OrderSourceEnum.Pos,
    FulfillmentTypeEnum? FulfillmentType = null,
    string? DeliveryAddress = null,
    string? ContactNumber = null,
    string? RejectionReason = null,
    DateTime? AcceptedAt = null,
    DateTime? ReadyAt = null,
    string? ReviewReasons = null,
    decimal? QuotedTotal = null,
    string? OfflineLocalId = null,
    List<string>? StockWarnings = null,
    List<Guid>? StockLineIds = null);
