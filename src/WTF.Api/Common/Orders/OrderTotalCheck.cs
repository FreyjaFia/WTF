namespace WTF.Api.Common.Orders;

internal static class OrderTotalCheck
{
    // The register sends the total the cashier saw and collected against. If prices, a promotion or its uses moved since
    // (another order took the last use, a price changed), the order is refused instead of being saved at a total nobody
    // agreed to.
    public static void EnsureUnchanged(decimal? expectedTotal, decimal serverTotal)
    {
        if (expectedTotal is null)
        {
            return;
        }

        var expected = Math.Round(expectedTotal.Value, 2, MidpointRounding.AwayFromZero);
        var actual = Math.Round(serverTotal, 2, MidpointRounding.AwayFromZero);
        if (expected != actual)
        {
            throw new InvalidOperationException(
                $"The total changed to PHP {actual:N2} while you were checking out (it was PHP {expected:N2}), "
                + "because a price or a promotion changed. Please review the order and try again.");
        }
    }
}
