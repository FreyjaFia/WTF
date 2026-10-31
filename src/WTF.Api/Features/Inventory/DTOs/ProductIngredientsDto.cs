namespace WTF.Api.Features.Inventory.DTOs;

public record ProductIngredientsRowDto(
    Guid ProductId,
    string Name,
    string Code,
    decimal Price,
    string Status,
    List<string> MissingOptions,
    int IngredientCount,
    decimal? Cost,
    int UnknownCostCount,
    decimal? Margin,
    decimal? MarginPercent);

public record ProductIngredientsDto(
    int Ready,
    int Partial,
    int Missing,
    bool ShowsCosts,
    List<ProductIngredientsRowDto> Products);
