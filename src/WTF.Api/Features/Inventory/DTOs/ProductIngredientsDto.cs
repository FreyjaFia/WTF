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

public record ProductIngredientLineDto(
    Guid LinkId,
    Guid ItemId,
    string ItemName,
    string UnitName,
    decimal QuantityPerSale,
    decimal AllowancePercent,
    bool ScalesWithSize,
    Guid? ReplacesItemId,
    string? ReplacesItemName,
    decimal? UnitCost,
    decimal? LineCost);

public record ProductIngredientsEditDto(
    Guid ProductId,
    string Name,
    decimal Price,
    bool IsAddOn,
    decimal RecipeMultiplier,
    bool ShowsCosts,
    decimal? SuppliesCost,
    List<ProductIngredientLineDto> Lines,
    decimal? TotalCost,
    int UnknownCostCount,
    decimal? Margin,
    decimal? MarginPercent);
