namespace WTF.Api.Features.Inventory.DTOs;

public record RecipeCostLineDto(
    Guid LinkId,
    Guid ItemId,
    string ItemName,
    string UnitName,
    decimal QuantityPerSale,
    decimal AllowancePercent,
    decimal EffectiveQuantity,
    decimal? UnitCost,
    decimal? LineCost);

public record RecipeCostDto(
    Guid ProductId,
    string ProductName,
    decimal Price,
    List<RecipeCostLineDto> Lines,
    decimal TotalCost,
    int UnknownCostCount,
    decimal Margin,
    decimal? MarginPercent);
