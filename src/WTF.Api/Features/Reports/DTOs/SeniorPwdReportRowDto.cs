namespace WTF.Api.Features.Reports.DTOs;

public sealed record SeniorPwdReportRowDto(
    Guid Id,
    Guid OrderId,
    int OrderNumber,
    DateTime OrderedAt,
    string Type,
    string CustomerName,
    string IdNumber,
    decimal CoveredAmount,
    decimal VatExemptAmount,
    decimal DiscountAmount,
    decimal NetAmount
);
