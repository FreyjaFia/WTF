namespace WTF.Api.Features.Inventory.DTOs;

public record StockLimitItemDto(Guid Id, string Name, string UnitName, decimal Balance);

public record StockLimitLinkDto(Guid ProductId, Guid ItemId, decimal QuantityPerSale);

public record PosStockLimitsDto(List<StockLimitItemDto> Items, List<StockLimitLinkDto> Links, DateTime AsOf);
