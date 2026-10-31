namespace WTF.Api.Features.Inventory.DTOs;

public record StockLimitItemDto(Guid Id, string Name, string UnitName, decimal Balance);

public record StockLimitLinkDto(
    Guid ProductId, Guid ItemId, decimal QuantityPerSale, bool ScalesWithSize = false, Guid? ReplacesItemId = null);

public record SizeMultiplierDto(Guid ProductId, decimal Multiplier);

public record StockLimitSizeAmountDto(Guid ProductId, Guid SizeProductId, Guid ItemId, decimal Quantity);

public record PosStockLimitsDto(
    List<StockLimitItemDto> Items, List<StockLimitLinkDto> Links, DateTime AsOf, List<SizeMultiplierDto>? SizeMultipliers = null,
    List<StockLimitSizeAmountDto>? SizeAmounts = null);
