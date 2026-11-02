namespace WTF.Api.Features.Reports.DTOs;

public sealed record StockVarianceReportRowDto(
    Guid ItemId,
    string ItemName,
    string UnitName,
    decimal Opening,
    decimal Received,
    decimal TheoreticalUsage,
    decimal Waste,
    decimal Corrections,
    decimal ActualUsage,
    decimal Closing,
    decimal Variance,
    decimal? VariancePercent,
    decimal? VarianceValue,
    string Status);
