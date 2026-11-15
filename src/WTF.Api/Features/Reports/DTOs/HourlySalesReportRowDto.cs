using System.Text.Json.Serialization;

namespace WTF.Api.Features.Reports.DTOs;

public sealed record HourlySalesReportRowDto(
    int Hour,
    int OrderCount,
    decimal Revenue,
    decimal GrossSales = 0m,
    decimal Discounts = 0m,
    decimal RefundedAmount = 0m,
    [property: JsonPropertyName("seniorPwdDiscounts")] decimal SeniorPwdReduction = 0m
);
