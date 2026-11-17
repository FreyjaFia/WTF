namespace WTF.Api.Features.Kitchen.DTOs;

public record KitchenLineDto(string Name, int Quantity, string? Note, List<KitchenAddOnDto> AddOns);
