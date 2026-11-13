using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

internal static class HeldOrderFigures
{
    public static async Task<List<HeldOrderFigure>> LoadAsync(
        WTFDbContext db,
        DateTime? fromUtc,
        DateTime? toExclusiveUtc,
        byte? source,
        CancellationToken cancellationToken)
    {
        var query = db.Orders.AsNoTracking().Where(o => o.StatusId == (int)OrderStatusEnum.PendingReview);

        if (fromUtc.HasValue && toExclusiveUtc.HasValue)
        {
            query = query.Where(o => o.CreatedAt >= fromUtc.Value && o.CreatedAt < toExclusiveUtc.Value);
        }

        if (source.HasValue)
        {
            query = query.Where(o => o.Source == source.Value);
        }

        var rows = await query
            .Select(o => new
            {
                o.CreatedAt,
                o.QuotedTotal,
                Lines = o.OrderItems
                    .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
                    .Select(oi => new { oi.SeniorPwdDiscount, oi.SeniorPwdVatExempt })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        return [.. rows.Select(r => new HeldOrderFigure(
            r.CreatedAt,
            r.QuotedTotal ?? 0m,
            r.Lines.Sum(l => l.SeniorPwdDiscount ?? 0m),
            r.Lines.Sum(l => l.SeniorPwdVatExempt ?? 0m)))];
    }
}
