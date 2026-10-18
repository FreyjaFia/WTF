namespace WTF.Api.Features.Reports.DTOs;

public sealed record PaymentsReportRowDto(
    string PaymentMethod,
    int OrderCount,
    decimal TotalAmount,
    decimal TotalPercent,
    decimal GrossSales = 0m,
    decimal Discounts = 0m,
    decimal RefundedAmount = 0m,
    decimal Tips = 0m
);
