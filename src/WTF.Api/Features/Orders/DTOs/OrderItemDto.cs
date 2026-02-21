namespace WTF.Api.Features.Orders.DTOs;

public record OrderItemDto(Guid Id, Guid ProductId, string ProductName, int Quantity, decimal? Price, List<OrderItemDto> AddOns, string? SpecialInstructions);
