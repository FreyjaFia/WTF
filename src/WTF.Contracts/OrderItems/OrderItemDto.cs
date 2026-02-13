namespace WTF.Contracts.OrderItems;

public record OrderItemDto(
    Guid Id,
    Guid ProductId,
    string ProductName,
    int Quantity,
    decimal? Price,
    List<OrderItemDto> AddOns
);
