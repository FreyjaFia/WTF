using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Data;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

// Every item has one stock row in every branch of its shop (zero where it holds nothing), so a list can read a branch's
// quantity without guessing. These rows are written with SQL because a person limited to one branch may still create an item
// or a branch that has to appear in the others.
internal static class StockBranchRows
{
    public static async Task AddItemAsync(
        WTFDbContext db, Guid itemId, Guid startingBranchId, decimal startingQuantity, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            var branchIds = await db.Branches.IgnoreQueryFilters([WTFDbContext.BranchFilterName]).Select(b => b.Id).ToListAsync(cancellationToken);
            foreach (var branchId in branchIds)
            {
                db.ItemBranchStocks.Add(new ItemBranchStock
                {
                    Id = Guid.NewGuid(),
                    ItemId = itemId,
                    BranchId = branchId,
                    CurrentQuantity = branchId == startingBranchId ? startingQuantity : 0m,
                    UpdatedAt = DateTime.UtcNow
                });
            }

            await db.SaveChangesAsync(cancellationToken);
            return;
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO dbo.ItemBranchStock (TenantId, ItemId, BranchId, CurrentQuantity, LastAlertStatus)
            SELECT i.TenantId, i.Id, b.Id, CASE WHEN b.Id = @startBranch THEN @quantity ELSE 0 END, 0
            FROM dbo.Items i
            JOIN dbo.Branches b ON b.TenantId = i.TenantId
            WHERE i.Id = @itemId
              AND (@filter = 0 OR i.TenantId = @tenant)
              AND NOT EXISTS (SELECT 1 FROM dbo.ItemBranchStock s WHERE s.ItemId = i.Id AND s.BranchId = b.Id)
            """,
            [
                new SqlParameter("@itemId", itemId),
                new SqlParameter("@startBranch", startingBranchId),
                new SqlParameter("@quantity", SqlDbType.Decimal) { Precision = 18, Scale = 3, Value = startingQuantity },
                new SqlParameter("@filter", db.TenantFilterEnabled ? 1 : 0),
                new SqlParameter("@tenant", SqlDbType.UniqueIdentifier) { Value = (object?)db.StampTenantId ?? DBNull.Value }
            ],
            cancellationToken);
    }

    // A new branch starts with no stock: a zero row for every item of the shop.
    public static async Task AddBranchAsync(WTFDbContext db, Guid branchId, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            var itemIds = await db.Items.Select(i => i.Id).ToListAsync(cancellationToken);
            foreach (var itemId in itemIds)
            {
                db.ItemBranchStocks.Add(new ItemBranchStock { Id = Guid.NewGuid(), ItemId = itemId, BranchId = branchId, UpdatedAt = DateTime.UtcNow });
            }

            await db.SaveChangesAsync(cancellationToken);
            return;
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO dbo.ItemBranchStock (TenantId, ItemId, BranchId, CurrentQuantity, LastAlertStatus)
            SELECT i.TenantId, i.Id, b.Id, 0, 0
            FROM dbo.Branches b
            JOIN dbo.Items i ON i.TenantId = b.TenantId
            WHERE b.Id = @branchId
              AND (@filter = 0 OR b.TenantId = @tenant)
              AND NOT EXISTS (SELECT 1 FROM dbo.ItemBranchStock s WHERE s.ItemId = i.Id AND s.BranchId = b.Id)
            """,
            [
                new SqlParameter("@branchId", branchId),
                new SqlParameter("@filter", db.TenantFilterEnabled ? 1 : 0),
                new SqlParameter("@tenant", SqlDbType.UniqueIdentifier) { Value = (object?)db.StampTenantId ?? DBNull.Value }
            ],
            cancellationToken);
    }
}
