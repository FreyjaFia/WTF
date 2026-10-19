using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public readonly record struct StockBalanceChange(decimal Before, decimal After);

internal static class StockBalance
{
    // Changes an item's balance by a delta in one statement, so two registers (or a register and a stock-in) can never
    // overwrite each other. A blocking item (AllowNegativeStock = false) is refused when the change would take it below
    // zero, unless the caller forces it (an offline sale that already happened). Returns null when refused or not found.
    public static async Task<StockBalanceChange?> ApplyAsync(
        WTFDbContext db,
        Guid itemId,
        decimal delta,
        bool allowBelowZero,
        CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            return await ApplyTrackedAsync(db, itemId, delta, allowBelowZero, cancellationToken);
        }

        var force = allowBelowZero ? 1 : 0;
        var updated = await db.Database.SqlQuery<decimal>($"""
            UPDATE dbo.Items
            SET CurrentQuantity = CurrentQuantity + {delta}
            OUTPUT INSERTED.CurrentQuantity AS [Value]
            WHERE Id = {itemId}
              AND ({force} = 1 OR AllowNegativeStock = 1 OR {delta} >= 0 OR CurrentQuantity + {delta} >= 0)
            """).ToListAsync(cancellationToken);

        if (updated.Count == 0)
        {
            return null;
        }

        return new StockBalanceChange(updated[0] - delta, updated[0]);
    }

    private static async Task<StockBalanceChange?> ApplyTrackedAsync(
        WTFDbContext db,
        Guid itemId,
        decimal delta,
        bool allowBelowZero,
        CancellationToken cancellationToken)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var before = item.CurrentQuantity;
        var after = before + delta;
        if (!allowBelowZero && !item.AllowNegativeStock && delta < 0 && after < 0)
        {
            return null;
        }

        item.CurrentQuantity = after;
        await db.SaveChangesAsync(cancellationToken);
        return new StockBalanceChange(before, after);
    }
}
