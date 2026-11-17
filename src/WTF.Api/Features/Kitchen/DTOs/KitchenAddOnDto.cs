namespace WTF.Api.Features.Kitchen.DTOs;

public record KitchenAddOnDto(string Name, int Quantity, string? Note, string? Type, bool IsTemperature);
