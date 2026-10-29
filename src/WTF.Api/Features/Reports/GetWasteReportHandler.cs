using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Inventory;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetWasteReportQuery : IRequest<List<WasteReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public string? GroupBy { get; init; }
    public Guid? ItemId { get; init; }
    public int? WasteReasonId { get; init; }
}

public sealed class GetWasteReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetWasteReportQuery, List<WasteReportRowDto>>
{
    public const string GroupByItem = "item";
    public const string GroupByReason = "reason";
    public const string GroupByStaff = "staff";
    public const string GroupByDay = "day";

    public static bool IsValidGroupBy(string? groupBy) =>
        string.IsNullOrWhiteSpace(groupBy)
        || groupBy.Trim().ToLowerInvariant() is GroupByItem or GroupByReason or GroupByStaff or GroupByDay;

    public async Task<List<WasteReportRowDto>> Handle(GetWasteReportQuery request, CancellationToken cancellationToken)
    {
        if (!IsValidGroupBy(request.GroupBy))
        {
            throw new InvalidOperationException("groupBy must be item, reason, staff or day.");
        }

        var groupBy = string.IsNullOrWhiteSpace(request.GroupBy) ? GroupByItem : request.GroupBy.Trim().ToLowerInvariant();
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);

        var entries = await db.StockWastes
            .AsNoTracking()
            .Where(w =>
                w.CreatedAt >= fromUtc
                && w.CreatedAt < toExclusiveUtc
                && w.Status != StockWasteStatuses.Reversed
                && (request.ItemId == null || w.ItemId == request.ItemId)
                && (request.WasteReasonId == null || w.WasteReasonId == request.WasteReasonId))
            .Select(w => new
            {
                w.ItemId,
                ItemName = w.Item.Name,
                w.Item.UnitName,
                w.WasteReasonId,
                w.ReasonName,
                w.CreatedBy,
                StaffName = (w.CreatedByNavigation.FirstName + " " + w.CreatedByNavigation.LastName).Trim(),
                w.CreatedAt,
                w.Quantity,
                w.Status
            })
            .ToReportListAsync(cancellationToken);

        var lines = entries
            .Select(e =>
            {
                var entry = new WasteEntry(e.Quantity, e.UnitName, e.Status == StockWasteStatuses.Disputed);

                return groupBy switch
                {
                    GroupByReason => new WasteLine(
                        e.WasteReasonId.ToString(CultureInfo.InvariantCulture), e.ReasonName, e.CreatedAt, entry),
                    GroupByStaff => new WasteLine(e.CreatedBy.ToString(), e.StaffName, e.CreatedAt, entry),
                    GroupByDay => DayLine(e.CreatedAt, timeZone, entry),
                    _ => new WasteLine(e.ItemId.ToString(), e.ItemName, e.CreatedAt, entry)
                };
            })
            .ToList();

        var rows = BuildRows(lines, groupBy == GroupByItem);

        return groupBy switch
        {
            GroupByDay => rows
                .OrderBy(r => r.GroupKey, StringComparer.Ordinal)
                .ToList(),
            GroupByItem => rows
                .OrderByDescending(r => r.Quantity)
                .ThenBy(r => r.Label, StringComparer.OrdinalIgnoreCase)
                .ToList(),
            _ => rows
                .OrderByDescending(r => r.EntryCount)
                .ThenBy(r => r.Label, StringComparer.OrdinalIgnoreCase)
                .ToList()
        };
    }

    private static WasteLine DayLine(DateTime createdAt, TimeZoneInfo timeZone, WasteEntry entry)
    {
        var day = ReportPeriods.LocalDate(createdAt, timeZone);

        return new WasteLine(
            day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            day.ToString("MMM d, yyyy", CultureInfo.InvariantCulture),
            createdAt,
            entry);
    }

    // Different items can use different units (ml, pieces), so only an item row carries a unit; other rows are counts of entries.
    private static List<WasteReportRowDto> BuildRows(List<WasteLine> lines, bool byItem) =>
        lines
            .GroupBy(l => l.Key)
            .Select(group =>
            {
                var latest = group.OrderByDescending(l => l.CreatedAt).First();
                var entries = group.Select(l => l.Entry).ToList();

                return ToRow(group.Key, latest.Label, byItem ? latest.Entry.UnitName : null, entries);
            })
            .ToList();

    private static WasteReportRowDto ToRow(string groupKey, string label, string? unitName, List<WasteEntry> entries)
    {
        var summary = WasteRules.Summarize(entries);

        return new WasteReportRowDto(
            groupKey,
            label,
            unitName,
            summary.EntryCount,
            summary.Quantity,
            summary.DisputedCount,
            summary.DisputedQuantity);
    }

    private sealed record WasteLine(string Key, string Label, DateTime CreatedAt, WasteEntry Entry);
}
