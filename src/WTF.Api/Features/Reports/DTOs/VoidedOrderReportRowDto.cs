namespace WTF.Api.Features.Reports.DTOs;

public sealed record VoidedOrderReportRowDto(
    Guid OrderId,
    int OrderNumber,
    DateTime OrderedAt,
    DateTime? VoidedAt,
    string Kind,
    string StaffName,
    string? VoidedBy,
    decimal Amount,
    string? Reason,
    decimal StaffVoidRate
);
