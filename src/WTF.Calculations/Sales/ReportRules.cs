namespace WTF.Calculations.Sales;

public static class ReportRules
{
    public static decimal DiscountGiven(decimal originalPrice, decimal price, int quantity) =>
        quantity <= 0 ? 0m : Math.Max(0m, originalPrice - price) * quantity;

    public static bool IsNewCustomer(DateTime firstSaleUtc, DateTime periodStartUtc) => firstSaleUtc >= periodStartUtc;

    public static double? MinutesBetween(DateTime? start, DateTime? end) =>
        start is null || end is null ? null : Math.Max(0d, (end.Value - start.Value).TotalMinutes);

    public static double? AverageMinutes(IEnumerable<double?> minutes)
    {
        var known = minutes.Where(m => m.HasValue).Select(m => m!.Value).ToList();
        return known.Count == 0 ? null : known.Average();
    }
}
