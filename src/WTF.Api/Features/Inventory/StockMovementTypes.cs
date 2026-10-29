namespace WTF.Api.Features.Inventory;

public static class StockMovementTypes
{
    public const string AddStock = "AddStock";
    public const string Sale = "Sale";
    public const string SaleVoid = "SaleVoid";
    public const string Waste = "Waste";
    public const string Adjustment = "Adjustment";
    public const string WasteReversed = "WasteReversed";

    public const string OrderReference = "Order";
    public const string StockWasteReference = "StockWaste";
}
