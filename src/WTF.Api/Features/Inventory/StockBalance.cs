using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Data;
using WTF.Api.Common.Tenancy;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public readonly record struct StockBalanceChange(decimal Before, decimal After);

internal static class StockBalance
{
    // Changes an item's balance in one branch by a delta in one statement, so two registers (or a register and a stock-in)
    // can never overwrite each other. A branch that never held the item gets its row (at zero) first. A blocking item
    // (AllowNegativeStock = false) is refused when the change would take it below zero, unless the caller forces it
    // (an offline sale that already happened). Returns null when refused or not found.
    public static async Task<StockBalanceChange?> ApplyAsync(
        WTFDbContext db,
        Guid itemId,
        Guid branchId,
        decimal delta,
        bool allowBelowZero,
        CancellationToken cancellationToken)
    {
        if (!db.MayWriteToBranch(branchId))
        {
            throw new InvalidOperationException("A row of another branch cannot be changed.");
        }

        if (!db.Database.IsRelational())
        {
            return await ApplyTrackedAsync(db, itemId, branchId, delta, allowBelowZero, cancellationToken);
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO dbo.ItemBranchStocks (TenantId, ItemId, BranchId, CurrentQuantity, LastAlertStatus)
            SELECT i.TenantId, i.Id, @branchId, 0, 0
            FROM dbo.Items i
            WHERE i.Id = @itemId
              AND (@filter = 0 OR i.TenantId = @tenant)
              AND EXISTS (SELECT 1 FROM dbo.Branches b WHERE b.Id = @branchId AND b.TenantId = i.TenantId)
              AND NOT EXISTS (SELECT 1 FROM dbo.ItemBranchStocks s WITH (UPDLOCK, HOLDLOCK) WHERE s.ItemId = i.Id AND s.BranchId = @branchId)
            """,
            [
                new SqlParameter("@itemId", itemId),
                new SqlParameter("@branchId", branchId),
                new SqlParameter("@filter", db.TenantFilterEnabled ? 1 : 0),
                new SqlParameter("@tenant", SqlDbType.UniqueIdentifier) { Value = (object?)db.StampTenantId ?? DBNull.Value }
            ],
            cancellationToken);

        // The quantity parameter is typed decimal(18, 3) like the column. An interpolated decimal would be sent as
        // decimal(18, 2), which silently drops the third decimal (a change of 0.001 would not move the balance).
        var updated = await db.Database.SqlQueryRaw<decimal>(
            """
            UPDATE s
            SET CurrentQuantity = s.CurrentQuantity + @delta, UpdatedAt = SYSUTCDATETIME()
            OUTPUT INSERTED.CurrentQuantity AS [Value]
            FROM dbo.ItemBranchStocks s
            JOIN dbo.Items i ON i.Id = s.ItemId
            WHERE s.ItemId = @itemId
              AND s.BranchId = @branchId
              AND (@filter = 0 OR s.TenantId = @tenant)
              AND (@force = 1 OR i.AllowNegativeStock = 1 OR @delta >= 0 OR s.CurrentQuantity + @delta >= 0)
            """,
            new SqlParameter("@delta", SqlDbType.Decimal) { Precision = 18, Scale = 3, Value = delta },
            new SqlParameter("@itemId", itemId),
            new SqlParameter("@branchId", branchId),
            new SqlParameter("@force", allowBelowZero ? 1 : 0),
            new SqlParameter("@filter", db.TenantFilterEnabled ? 1 : 0),
            new SqlParameter("@tenant", SqlDbType.UniqueIdentifier) { Value = (object?)db.StampTenantId ?? DBNull.Value }).ToListAsync(cancellationToken);

        if (updated.Count == 0)
        {
            return null;
        }

        return new StockBalanceChange(updated[0] - delta, updated[0]);
    }

    // What the whole shop holds (every branch, whatever the person may see). Costs are one per shop, so a weighted average
    // blends what all the branches hold.
    public static async Task<decimal> ShopQuantityAsync(WTFDbContext db, Guid itemId, CancellationToken cancellationToken)
    {
        return await db.ItemBranchStocks
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .AsNoTracking()
            .Where(s => s.ItemId == itemId)
            .SumAsync(s => s.CurrentQuantity, cancellationToken);
    }

    public static async Task<decimal> QuantityAsync(WTFDbContext db, Guid itemId, Guid branchId, CancellationToken cancellationToken)
    {
        return await db.ItemBranchStocks
            .AsNoTracking()
            .Where(s => s.ItemId == itemId && s.BranchId == branchId)
            .Select(s => s.CurrentQuantity)
            .FirstOrDefaultAsync(cancellationToken);
    }

    // The branch a stock change made by the signed-in person lands in: the one they work in, or the shop's Main branch
    // for code that has no signed-in branch (jobs, public links).
    public static async Task<Guid> ResolveBranchAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        if (db.ActiveBranchId is { } active)
        {
            return active;
        }

        var main = await db.Branches
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(b => b.IsMain && (!db.TenantFilterEnabled || b.TenantId == db.StampTenantId))
            .Select(b => (Guid?)b.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return main ?? throw new InvalidOperationException(BranchScopeMiddleware.PickBranchMessage);
    }

    private static async Task<StockBalanceChange?> ApplyTrackedAsync(
        WTFDbContext db,
        Guid itemId,
        Guid branchId,
        decimal delta,
        bool allowBelowZero,
        CancellationToken cancellationToken)
    {
        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var stock = await db.ItemBranchStocks.FirstOrDefaultAsync(s => s.ItemId == itemId && s.BranchId == branchId, cancellationToken);
        if (stock is null)
        {
            stock = new ItemBranchStock { Id = Guid.NewGuid(), ItemId = itemId, BranchId = branchId, UpdatedAt = DateTime.UtcNow };
            db.ItemBranchStocks.Add(stock);
        }

        var before = stock.CurrentQuantity;
        var after = before + delta;
        if (!allowBelowZero && !item.AllowNegativeStock && delta < 0 && after < 0)
        {
            if (db.Entry(stock).State == EntityState.Added)
            {
                db.Entry(stock).State = EntityState.Detached;
            }

            return null;
        }

        stock.CurrentQuantity = after;
        stock.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new StockBalanceChange(before, after);
    }
}
