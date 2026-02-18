using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders.Enums;

namespace WTF.Contracts.Orders;

public record OrderDto(
    Guid Id,
    int OrderNumber,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    List<OrderItemDto> Items,
    Guid? CustomerId,
    OrderStatusEnum Status,
    PaymentMethodEnum? PaymentMethod,
    decimal? AmountReceived,
    decimal? ChangeAmount,
    decimal? Tips,
    string? SpecialInstructions,
    decimal TotalAmount
);