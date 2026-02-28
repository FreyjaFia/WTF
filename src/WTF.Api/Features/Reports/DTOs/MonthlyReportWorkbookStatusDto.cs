namespace WTF.Api.Features.Reports.DTOs;

public sealed record MonthlyReportWorkbookStatusDto(
    int Year,
    int Month,
    bool Exists,
    string FileName,
    DateTime? GeneratedAtUtc,
    long? SizeBytes);
