namespace WTF.Contracts.OrderItems;

public record OrderItemRequestDto(
    Guid ProductId,
    int Quantity,
    List<OrderItemRequestDto> AddOns,
    string? SpecialInstructions
);
