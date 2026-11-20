namespace WTF.Api.Features.Inventory.Transfers;

public record StockTransferLineDto(Guid ItemId, string ItemName, string UnitName, decimal Quantity, decimal? UnitCost);

public record StockTransferSummaryDto(
    Guid Id,
    Guid FromBranchId,
    string FromBranchCode,
    string FromBranchName,
    Guid ToBranchId,
    string ToBranchCode,
    string ToBranchName,
    string? Notes,
    DateTime CreatedAt,
    string CreatedByName,
    int LineCount,
    decimal TotalQuantity);

public record StockTransferDto(StockTransferSummaryDto Summary, List<StockTransferLineDto> Lines);

public record StockTransferLineRequest(Guid ItemId, decimal Quantity);
