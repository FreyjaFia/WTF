namespace WTF.Api.Features.Reports.DTOs;

public sealed record WasteReportRowDto(
    string GroupKey,
    string Label,
    string? UnitName,
    int EntryCount,
    decimal Quantity,
    int DisputedCount = 0,
    decimal DisputedQuantity = 0m);
