namespace WTF.Api.Features.Reports.DTOs;

public sealed record HourlySalesReportRowDto(
    int Hour,
    int OrderCount,
    decimal Revenue
);
