namespace WTF.Api.Features.Orders.DTOs;

public record OrderItemRequestDto(Guid ProductId, int Quantity, List<OrderItemRequestDto> AddOns, string? SpecialInstructions);
