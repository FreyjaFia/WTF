using WTF.Contracts.OrderItems;

namespace WTF.Contracts.Orders;

public record OrderDto(
    Guid Id,
    string OrderNumber,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    List<OrderItemDto> Items,
    Guid? CustomerId,
    int Status
);