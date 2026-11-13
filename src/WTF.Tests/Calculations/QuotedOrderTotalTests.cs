using WTF.Calculations.Orders;

namespace WTF.Tests.Calculations;

public class QuotedOrderTotalTests
{
    [Fact]
    public void OfLines_MultipliesEachLineAndItsAddOnsByTheQuantity()
    {
        var latte = new QuotedLine(2, 100m, [new QuotedLine(3, 10m, [])]);
        var cake = new QuotedLine(1, 55.5m, []);

        QuotedOrderTotal.OfLines([latte, cake], []).ShouldBe(2 * (100m + 3 * 10m) + 55.5m);
    }

    [Fact]
    public void OfLines_CountsBundlesAtTheirQuotedUnitPrice()
    {
        QuotedOrderTotal.OfLines([new QuotedLine(1, 40m, [])], [(2, 75m)]).ShouldBe(190m);
    }

    [Fact]
    public void OfLines_ALineWithoutAQuotedPriceCountsAsZero()
    {
        QuotedOrderTotal.OfLines([new QuotedLine(2, null, [])], [(1, null)]).ShouldBe(0m);
    }

    [Fact]
    public void OfLines_NothingQuoted_IsZero()
    {
        QuotedOrderTotal.OfLines([], []).ShouldBe(0m);
    }
}
