namespace WTF.Api.Features.Reports.DTOs;

public sealed record DailyCloseReportRowDto(
    string Section,
    string Label,
    string? Detail,
    int OrderCount,
    decimal Amount
);
