namespace WTF.Calculations.Orders;

public readonly record struct HeldOrderFigure(DateTime SoldAtUtc, decimal Amount, decimal SeniorPwdDiscount = 0m, decimal SeniorPwdVatExempt = 0m);

public readonly record struct HeldOrderSummary(
    int Count,
    decimal Amount,
    int AgedCount,
    decimal AgedAmount,
    decimal SeniorPwdDiscount,
    decimal SeniorPwdVatExempt);

public static class HeldOrderRules
{
    public const int DefaultAgedAfterDays = 2;

    public const string SeniorPwdCodePrefix = "SeniorPwd";

    public const string SkippedSeniorPwd = "SeniorPwd";

    public static int AgeDays(DateTime soldAtUtc, DateTime nowUtc)
    {
        var elapsed = nowUtc - soldAtUtc;
        return elapsed <= TimeSpan.Zero ? 0 : (int)Math.Floor(elapsed.TotalDays);
    }

    public static bool IsAged(DateTime soldAtUtc, DateTime nowUtc, int agedAfterDays = DefaultAgedAfterDays)
    {
        var days = agedAfterDays < 0 ? DefaultAgedAfterDays : agedAfterDays;
        return nowUtc - soldAtUtc > TimeSpan.FromDays(days);
    }

    public static HeldOrderSummary Summarize(IEnumerable<HeldOrderFigure> orders, DateTime nowUtc, int agedAfterDays = DefaultAgedAfterDays)
    {
        var count = 0;
        var amount = 0m;
        var agedCount = 0;
        var agedAmount = 0m;
        var discount = 0m;
        var vatExempt = 0m;

        foreach (var order in orders)
        {
            count++;
            amount += order.Amount;
            discount += order.SeniorPwdDiscount;
            vatExempt += order.SeniorPwdVatExempt;

            if (IsAged(order.SoldAtUtc, nowUtc, agedAfterDays))
            {
                agedCount++;
                agedAmount += order.Amount;
            }
        }

        return new HeldOrderSummary(count, amount, agedCount, agedAmount, discount, vatExempt);
    }

    public static bool IsSeniorPwdCode(string? code) =>
        code is not null && code.StartsWith(SeniorPwdCodePrefix, StringComparison.Ordinal);

    // Each Senior/PWD hold is a tax record that an Admin decides one by one. Bulk approve leaves such an order alone unless
    // the filter names every Senior/PWD code it holds, which means the Admin asked for exactly those orders.
    public static string? BulkSkipReason(IEnumerable<string> holdCodes, IReadOnlyCollection<string> filterCodes)
    {
        var seniorPwdCodes = holdCodes.Where(IsSeniorPwdCode).Distinct(StringComparer.Ordinal).ToList();
        if (seniorPwdCodes.Count == 0)
        {
            return null;
        }

        return seniorPwdCodes.All(code => filterCodes.Contains(code, StringComparer.Ordinal)) ? null : SkippedSeniorPwd;
    }

    public static string AgedInsightText(int count, decimal amount, int agedAfterDays = DefaultAgedAfterDays)
    {
        var orders = count == 1 ? "1 offline order has" : $"{count} offline orders have";
        var days = agedAfterDays == 1 ? "1 day" : $"{agedAfterDays} days";
        return $"{orders} waited more than {days} for review (PHP {amount:N2})";
    }
}
