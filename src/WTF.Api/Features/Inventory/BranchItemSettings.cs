using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

// What one branch uses for an item: its own warning and critical level, par level and cost when it set them, otherwise the
// item's shop values. Anything that records a cost or judges a stock level for a branch reads it here.
public readonly record struct BranchItemSettings(
    decimal? WarningQuantity,
    decimal? CriticalQuantity,
    decimal? ParLevel,
    decimal? BranchCost,
    decimal? UnitCost)
{
    public static BranchItemSettings For(Item item, ItemBranchStock? stock)
    {
        return new BranchItemSettings(
            BranchStockRules.Level(stock?.WarningQuantity, item.WarningQuantity),
            BranchStockRules.Level(stock?.CriticalQuantity, item.CriticalQuantity),
            BranchStockRules.Level(stock?.ParLevel, item.ParLevel),
            stock?.CostPrice,
            CostRules.BranchMovementCost(stock?.CostPrice, item.AverageCost, item.CostPrice));
    }

    public static async Task<BranchItemSettings> LoadAsync(WTFDbContext db, Item item, Guid branchId, CancellationToken cancellationToken)
    {
        var stock = await db.ItemBranchStocks.AsNoTracking()
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .FirstOrDefaultAsync(s => s.ItemId == item.Id && s.BranchId == branchId, cancellationToken);
        return For(item, stock);
    }
}

// The cost each item has in the branch the person works in. Working in "All branches" has no single branch, so nothing is
// overridden and the shop cost shows.
internal static class BranchItemCosts
{
    public static async Task<Dictionary<Guid, decimal?>> LoadAsync(WTFDbContext db, IEnumerable<Guid> itemIds, CancellationToken cancellationToken)
    {
        if (db.ActiveBranchId is not { } branchId)
        {
            return [];
        }

        var ids = itemIds.Distinct().ToList();
        return await db.ItemBranchStocks.AsNoTracking()
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(s => s.BranchId == branchId && ids.Contains(s.ItemId) && s.CostPrice != null)
            .ToDictionaryAsync(s => s.ItemId, s => s.CostPrice, cancellationToken);
    }
}
