using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Orders.DTOs;

public record UnsyncedOrderDto(
    Guid Id,
    string OfflineLocalId,
    string ErrorText,
    string ErrorCode,
    Guid CashierUserId,
    string? CashierName,
    DateTime? DeviceCreatedAt,
    DateTime ReceivedAt,
    decimal? QuotedTotal,
    UnsyncedOrderStatusEnum Status,
    UnsyncedOrderResolutionEnum? Resolution,
    string? ResolvedByName,
    DateTime? ResolvedAt,
    string? DiscardReason,
    Guid? ResultingOrderId,
    int LineCount);

public record UnsyncedOrderLineDto(
    Guid ProductId,
    string? ProductName,
    int Quantity,
    decimal? QuotedPrice,
    string? SpecialInstructions,
    List<UnsyncedOrderLineDto> AddOns);

public record UnsyncedOrderDetailDto(
    UnsyncedOrderDto Order,
    List<UnsyncedOrderLineDto> Lines,
    PaymentMethodEnum? PaymentMethod,
    decimal? AmountReceived,
    decimal? ChangeAmount,
    decimal? Tips,
    string? Note,
    string? SpecialInstructions);

public record UnsyncedOrderRetryResultDto(
    bool Resolved,
    string? Error,
    Guid? OrderId,
    int? OrderNumber,
    UnsyncedOrderDto Order);
