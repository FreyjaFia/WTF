using Microsoft.EntityFrameworkCore;

namespace WTF.Api.Common.Orders;

internal static class ReportQueryLimits
{
    public const int MaxRowsPerReport = 100_000;

    public static async Task<List<T>> ToReportListAsync<T>(
        this IQueryable<T> query,
        CancellationToken cancellationToken,
        int maxRows = MaxRowsPerReport)
    {
        var rows = await query.Take(maxRows + 1).ToListAsync(cancellationToken);

        if (rows.Count > maxRows)
        {
            throw new InvalidOperationException(
                $"This report covers more than {maxRows:N0} rows. Narrow the date range or filters and try again.");
        }

        return rows;
    }
}
