namespace WTF.Contracts.OrderItems;

public record OrderItemDto(
    Guid Id,
    Guid ProductId,
    int Quantity,
    decimal? Price
);
