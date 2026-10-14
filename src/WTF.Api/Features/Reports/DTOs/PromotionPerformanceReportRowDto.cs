namespace WTF.Api.Features.Reports.DTOs;

public sealed record PromotionPerformanceReportRowDto(
    string PromotionName,
    string PromotionType,
    int Uses,
    decimal Revenue,
    decimal? DiscountGiven
);
