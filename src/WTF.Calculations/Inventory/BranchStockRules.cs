namespace WTF.Calculations.Inventory;

public static class BranchStockRules
{
    // A branch can set its own warning, critical or par level for an item; without one it uses the item's shop level.
    public static decimal? Level(decimal? branchLevel, decimal? shopLevel) => branchLevel ?? shopLevel;
}
