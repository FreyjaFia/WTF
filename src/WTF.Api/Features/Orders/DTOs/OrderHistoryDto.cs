using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Orders.DTOs;

public record OrderHistoryDto(
    Guid Id,
    int OrderNumber,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    Guid? CustomerId,
    OrderStatusEnum Status,
    PaymentMethodEnum? PaymentMethod,
    decimal? AmountReceived,
    decimal? ChangeAmount,
    decimal? Tips,
    string? SpecialInstructions,
    string? Note,
    decimal TotalAmount,
    string? CustomerName = null);
