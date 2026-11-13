using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Calculations.Time;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public sealed record HeldOrderFilter(
    IReadOnlyList<string>? ReasonCodes = null,
    Guid? CashierId = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    bool AgedOnly = false,
    IReadOnlyList<Guid>? Ids = null);

internal static class HeldOrderAging
{
    // The one place that says how many days a held order may wait. The policy table will answer here later.
    public static Task<int> AgedAfterDaysAsync(WTFDbContext db, CancellationToken cancellationToken) =>
        Task.FromResult(HeldOrderRules.DefaultAgedAfterDays);
}

internal static class HeldOrderQueries
{
    public const int MaxOrders = 500;

    public static IQueryable<Order> Matching(WTFDbContext db, HeldOrderFilter filter, TimeZoneInfo timeZone, DateTime nowUtc, int agedAfterDays)
    {
        var query = db.Orders.Where(o => o.StatusId == (int)OrderStatusEnum.PendingReview);

        if (filter.Ids is { Count: > 0 })
        {
            var ids = filter.Ids;
            query = query.Where(o => ids.Contains(o.Id));
        }

        if (filter.ReasonCodes is { Count: > 0 })
        {
            var codes = filter.ReasonCodes;
            var hold = (byte)ReviewSeverityEnum.Hold;
            query = query.Where(o => o.OrderReviewReasons.Any(r => codes.Contains(r.Code) && r.Severity == hold));
        }

        if (filter.CashierId.HasValue)
        {
            var cashierId = filter.CashierId.Value;
            query = query.Where(o => o.CreatedBy == cashierId);
        }

        if (filter.FromDate.HasValue)
        {
            var (fromUtc, _) = ReportDateRange.ToUtcRange(filter.FromDate.Value, filter.FromDate.Value, timeZone);
            query = query.Where(o => o.CreatedAt >= fromUtc);
        }

        if (filter.ToDate.HasValue)
        {
            var (_, toExclusiveUtc) = ReportDateRange.ToUtcRange(filter.ToDate.Value, filter.ToDate.Value, timeZone);
            query = query.Where(o => o.CreatedAt < toExclusiveUtc);
        }

        if (filter.AgedOnly)
        {
            var cutoff = nowUtc.AddDays(-agedAfterDays);
            query = query.Where(o => o.CreatedAt < cutoff);
        }

        return query;
    }

    public static async Task<Dictionary<Guid, List<OrderReviewReason>>> LoadReasonsAsync(
        WTFDbContext db, IReadOnlyCollection<Guid> orderIds, CancellationToken cancellationToken)
    {
        var rows = await db.OrderReviewReasons
            .AsNoTracking()
            .Where(r => orderIds.Contains(r.OrderId))
            .OrderBy(r => r.SortOrder)
            .ToListAsync(cancellationToken);

        return rows.GroupBy(r => r.OrderId).ToDictionary(g => g.Key, g => g.ToList());
    }

    public static List<string> HoldCodes(IEnumerable<OrderReviewReason>? reasons) =>
        [.. (reasons ?? []).Where(r => r.Severity == (byte)ReviewSeverityEnum.Hold).Select(r => r.Code).Distinct()];
}
