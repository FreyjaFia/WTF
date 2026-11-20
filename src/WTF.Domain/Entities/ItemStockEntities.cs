namespace WTF.Domain.Entities;

public partial class Item
{
    // What the loaded branch rows add up to: the branch the person works in, or every branch they may see.
    // Load ItemBranchStocks first; the legacy Items.CurrentQuantity column is no longer read.
    public decimal QuantityOnHand => ItemBranchStocks.Sum(s => s.CurrentQuantity);
}
