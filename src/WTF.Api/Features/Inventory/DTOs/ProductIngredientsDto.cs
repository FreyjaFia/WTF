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
    decimal? MarginPercent,
    List<ProductIngredientSizeDto>? Sizes = null,
    List<ProductIngredientAddOnOptionDto>? AddOnOptions = null,
    string? SubCategoryName = null);

public record ProductIngredientsDto(
    int Ready,
    int Partial,
    int Missing,
    bool ShowsCosts,
    List<ProductIngredientsRowDto> Products);

public record ProductIngredientSizeDto(Guid ProductId, string Name, decimal RecipeMultiplier);

public record ProductIngredientAddOnOptionDto(Guid ProductId, string Name, bool IsSize, decimal RecipeMultiplier);

public record ProductIngredientSizeAmountDto(Guid SizeProductId, decimal Quantity);

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
    decimal? LineCost,
    List<ProductIngredientSizeAmountDto>? SizeAmounts = null);

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
    decimal? MarginPercent,
    List<ProductIngredientSizeDto>? Sizes = null,
    List<ProductIngredientAddOnOptionDto>? AddOnOptions = null);
