namespace WTF.Api.Features.Inventory.Purchasing;

public static class PurchaseOrderStatuses
{
    public const byte Draft = 1;
    public const byte Sent = 2;
    public const byte PartlyReceived = 3;
    public const byte Received = 4;
    public const byte Cancelled = 5;

    public static bool IsOpen(byte status) => status is Sent or PartlyReceived;
}

public record PurchaseOrderSummaryDto(
    Guid Id,
    int PoNumber,
    Guid SupplierId,
    string SupplierName,
    byte Status,
    DateOnly? ExpectedOn,
    string? Note,
    DateTime CreatedAt,
    string CreatedByName,
    DateTime? SentAt,
    int LineCount,
    decimal? Total);

public record PurchaseOrderLineDto(
    Guid ItemId,
    string ItemName,
    string UnitName,
    string? PackName,
    decimal UnitsPerPack,
    decimal? PackPrice,
    decimal PacksOrdered,
    decimal PacksReceived,
    decimal? LineTotal);

public record PurchaseOrderDto(PurchaseOrderSummaryDto Summary, List<PurchaseOrderLineDto> Lines, List<Guid> ReceiptIds);
