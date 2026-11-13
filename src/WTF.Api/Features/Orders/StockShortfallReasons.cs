using Microsoft.EntityFrameworkCore;
using System.Globalization;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal static class StockShortfallReasons
{
    public static List<OfflineReason> ToReasons(IEnumerable<StockShortfallNote>? shortfalls)
    {
        return [.. (shortfalls ?? []).Select(s => OfflineReason.Note(
            OfflineReasonCodes.StockShortfall,
            $"{s.ItemName} ran short: {Format(s.Before)} {s.Unit} in stock, this sale needed {Format(s.Needed)} {s.Unit}. Count it and correct the stock.",
            null,
            Format(s.Before),
            Format(s.Needed)))];
    }

    public static async Task<List<OrderReviewReasonDto>> SaveAsync(
        WTFDbContext db, Order order, IEnumerable<StockShortfallNote>? shortfalls, CancellationToken cancellationToken)
    {
        var reasons = ToReasons(shortfalls);
        if (reasons.Count == 0)
        {
            return [];
        }

        var next = await db.OrderReviewReasons.CountAsync(r => r.OrderId == order.Id, cancellationToken);
        foreach (var reason in reasons)
        {
            db.OrderReviewReasons.Add(OrderReviewReasons.ToRow(order, reason, next++));
        }

        await db.SaveChangesAsync(cancellationToken);
        return [.. reasons.Select(OrderReviewReasons.ToDto)];
    }

    private static string Format(decimal quantity) => quantity.ToString("0.###", CultureInfo.InvariantCulture);
}
