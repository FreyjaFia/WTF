namespace WTF.Calculations.Orders;

public sealed record QuotedLine(int Quantity, decimal? QuotedPrice, IReadOnlyList<QuotedLine> AddOns);

public static class QuotedOrderTotal
{
    public static decimal OfLines(IEnumerable<QuotedLine> lines, IEnumerable<(int Quantity, decimal? QuotedUnitPrice)> bundles)
    {
        var linesTotal = lines.Sum(line => line.Quantity * (line.QuotedPrice.GetValueOrDefault() + line.AddOns.Sum(addOn => addOn.Quantity * addOn.QuotedPrice.GetValueOrDefault())));
        var bundlesTotal = bundles.Sum(bundle => bundle.Quantity * bundle.QuotedUnitPrice.GetValueOrDefault());
        return linesTotal + bundlesTotal;
    }
}
