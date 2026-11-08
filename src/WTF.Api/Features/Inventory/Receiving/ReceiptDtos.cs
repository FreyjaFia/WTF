namespace WTF.Api.Features.Inventory.Receiving;

public record StockReceiptSummaryDto(
    Guid Id,
    Guid SupplierId,
    string SupplierName,
    DateOnly ReceivedOn,
    string? InvoiceNumber,
    decimal? InvoiceTotal,
    decimal? LinesTotal,
    decimal? Difference,
    string? Note,
    DateTime CreatedAt,
    string CreatedByName,
    int LineCount,
    Guid? PurchaseOrderId,
    int? PurchaseOrderNumber);

public record StockReceiptLineDto(
    Guid ItemId,
    string ItemName,
    string UnitName,
    string? PackName,
    decimal Packs,
    decimal UnitsPerPack,
    decimal? PackPrice,
    decimal Quantity,
    decimal? UnitCost,
    decimal? LineTotal);

public record StockReceiptDto(StockReceiptSummaryDto Summary, List<StockReceiptLineDto> Lines);
