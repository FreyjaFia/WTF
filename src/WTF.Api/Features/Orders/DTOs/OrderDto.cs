using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Orders.DTOs;

public record OrderDto(
    Guid Id, int OrderNumber, DateTime CreatedAt, Guid CreatedBy, DateTime? UpdatedAt, Guid? UpdatedBy,
    List<OrderItemDto> Items, Guid? CustomerId, OrderStatusEnum Status, PaymentMethodEnum? PaymentMethod,
    decimal? AmountReceived, decimal? ChangeAmount, decimal? Tips, string? SpecialInstructions, decimal TotalAmount,
    string? CustomerName = null);
