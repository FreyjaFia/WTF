namespace WTF.Api.Features.Inventory.Suppliers;

public record SupplierSummaryDto(
    Guid Id,
    string Name,
    string? ContactName,
    string? Phone,
    string? Email,
    string? Address,
    int? LeadTimeDays,
    string? PaymentTerms,
    string? Notes,
    bool IsActive,
    int ItemCount);

public record SupplierItemDto(
    Guid LinkId,
    Guid ItemId,
    string ItemName,
    string UnitName,
    string? SupplierItemCode,
    string? PackName,
    decimal UnitsPerPack,
    decimal? PackPrice,
    decimal? UnitCost,
    bool IsPreferred);

public record SupplierDto(SupplierSummaryDto Summary, List<SupplierItemDto> Items);

public record ItemSupplierDto(
    Guid LinkId,
    Guid SupplierId,
    string SupplierName,
    bool SupplierIsActive,
    int? LeadTimeDays,
    string? SupplierItemCode,
    string? PackName,
    decimal UnitsPerPack,
    decimal? PackPrice,
    decimal? UnitCost,
    bool IsPreferred,
    bool IsCheapest,
    decimal? LastChangePercent,
    List<SupplierPriceChangeDto> PriceHistory);

public record SupplierPriceChangeDto(decimal? OldPackPrice, decimal NewPackPrice, string Source, DateTime ChangedAt, string ChangedByName);
