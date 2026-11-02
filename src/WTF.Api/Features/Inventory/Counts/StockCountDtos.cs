namespace WTF.Api.Features.Inventory.Counts;

public static class StockCountStatuses
{
    public const byte Open = 1;
    public const byte Posted = 2;
    public const byte Cancelled = 3;
}

public record StockCountSummaryDto(
    Guid Id,
    string Name,
    byte Status,
    bool IsBlind,
    string? Note,
    DateTime CreatedAt,
    string CreatedByName,
    DateTime? PostedAt,
    int LineCount,
    int CountedCount);

public record StockCountLineDto(
    Guid ItemId,
    string ItemName,
    string UnitName,
    decimal? CountedQuantity,
    decimal? ExpectedQuantity,
    decimal? Difference,
    bool AdjustmentPosted);

public record StockCountDto(StockCountSummaryDto Summary, List<StockCountLineDto> Lines);
