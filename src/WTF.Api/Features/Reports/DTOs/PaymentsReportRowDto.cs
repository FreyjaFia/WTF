namespace WTF.Api.Features.Reports.DTOs;

public sealed record PaymentsReportRowDto(
    string PaymentMethod,
    int OrderCount,
    decimal TotalAmount,
    decimal TotalPercent
);
