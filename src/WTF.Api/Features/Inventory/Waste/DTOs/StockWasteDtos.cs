namespace WTF.Api.Features.Inventory.Waste.DTOs;

public record StockWasteDto(
    Guid Id,
    Guid ItemId,
    string ItemName,
    string BaseUnit,
    decimal Quantity,
    int WasteReasonId,
    string ReasonName,
    string? Notes,
    string Status,
    bool RequiresReview,
    decimal QuantityBefore,
    decimal QuantityAfter,
    DateTime CreatedAt,
    Guid CreatedBy,
    string CreatedByName,
    DateTime? ReviewedAt,
    string? ReviewedByName,
    string? ReviewNote,
    DateTime? ReversedAt,
    string? ReversedByName,
    string? ReversalReason,
    int Source);

public record PagedStockWasteDto(List<StockWasteDto> Items, int TotalCount, int PendingCount);

public record PendingWasteCountDto(int Count);

public record WasteReasonDto(int Id, string Name, bool RequiresNote, int SortOrder, bool IsActive, bool IsSystem);
