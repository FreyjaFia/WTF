namespace WTF.Calculations.Orders;

public static class OrderLabels
{
    public const int PaddedDigits = 4;

    // What people say and read for an order: "MKT-0042" when the shop has several branches (each branch counts its own
    // orders from 1, so the number alone is not enough), "#42" for a one-branch shop, where nothing about branches shows.
    public static string Number(int orderNumber, string? branchCode, bool showBranch)
    {
        var code = branchCode?.Trim();
        return showBranch && !string.IsNullOrEmpty(code)
            ? $"{code}-{orderNumber.ToString().PadLeft(PaddedDigits, '0')}"
            : $"#{orderNumber}";
    }
}
