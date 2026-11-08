namespace WTF.Api.Features.Inventory.Reordering;

public record ReorderLineDto(
    Guid ItemId,
    string ItemName,
    string UnitName,
    decimal OnHand,
    decimal ParLevel,
    decimal OnOrder,
    decimal? DaysOfCover,
    decimal SuggestedUnits,
    decimal? SuggestedPacks,
    string? PackName,
    decimal? UnitsPerPack,
    decimal? PackPrice,
    decimal? EstimatedCost);

public record ReorderGroupDto(
    Guid? SupplierId,
    string SupplierName,
    int? LeadTimeDays,
    decimal? EstimatedCost,
    List<ReorderLineDto> Lines);

public record ReorderListDto(List<ReorderGroupDto> Groups, int BelowParCount, int ItemsWithoutPar);

public record ParLevelRowDto(Guid ItemId, string ItemName, string UnitName, decimal OnHand, decimal? ParLevel);
