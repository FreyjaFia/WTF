using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetProfitLossReportQuery : IRequest<List<ProfitLossReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public ReportGroupByEnum? GroupBy { get; init; }
}

// The Gross Profit report with the shop's running costs taken off: actual gross profit minus the expenses dated in the
// period gives an estimate of operating profit. It is management reporting, not accounting. An expense belongs to the period
// its date falls in (a local day, as entered), a period with expenses and no sales still gets a row, and a period whose gross
// profit is not known shows the expenses but no operating profit, so a missing cost never makes the shop look better.
public sealed class GetProfitLossReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProfitLossReportQuery, List<ProfitLossReportRowDto>>
{
    public async Task<List<ProfitLossReportRowDto>> Handle(GetProfitLossReportQuery request, CancellationToken cancellationToken)
    {
        var groupBy = request.GroupBy ?? ReportGroupByEnum.Day;
        var period = groupBy switch
        {
            ReportGroupByEnum.Week => ReportPeriod.Week,
            ReportGroupByEnum.Month => ReportPeriod.Month,
            _ => ReportPeriod.Day
        };

        var gross = await new GetGrossProfitReportHandler(db, httpContextAccessor).Handle(
            new GetGrossProfitReportQuery { FromDate = request.FromDate, ToDate = request.ToDate, GroupBy = groupBy },
            cancellationToken);

        var from = DateOnly.FromDateTime(request.FromDate ?? default);
        var to = DateOnly.FromDateTime(request.ToDate ?? default);
        var expenses = await db.Expenses
            .AsNoTracking()
            .Where(e => e.IsActive && e.ExpenseDate >= from && e.ExpenseDate <= to)
            .Select(e => new { e.ExpenseDate, e.Amount })
            .ToListAsync(cancellationToken);

        var expensesByPeriod = expenses
            .GroupBy(e => ReportPeriods.PeriodStartOfLocalDate(e.ExpenseDate.ToDateTime(TimeOnly.MinValue), period))
            .ToDictionary(group => group.Key, group => group.Sum(e => e.Amount));

        var grossByPeriod = gross.ToDictionary(row => row.PeriodStart);

        return [.. grossByPeriod.Keys
            .Union(expensesByPeriod.Keys)
            .OrderBy(key => key)
            .Select(key =>
            {
                grossByPeriod.TryGetValue(key, out var row);
                var spent = expensesByPeriod.GetValueOrDefault(key);
                var netSales = row?.NetSales ?? 0m;
                var actual = row is null ? 0m : row.ActualProfit;
                var summary = ProfitRules.OperatingProfit(netSales, actual, spent);

                return new ProfitLossReportRowDto(
                    key,
                    netSales,
                    row?.Cost ?? 0m,
                    row?.WasteCost ?? 0m,
                    row?.CountVariance ?? 0m,
                    actual,
                    summary.Expenses,
                    summary.OperatingProfit,
                    summary.MarginPercent,
                    row?.CostStatus ?? "Known");
            })];
    }
}
