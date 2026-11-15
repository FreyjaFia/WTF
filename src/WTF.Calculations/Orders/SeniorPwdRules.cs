namespace WTF.Calculations.Orders;

public readonly record struct SeniorPwdAmounts(decimal Covered, decimal VatExempt, decimal Discount)
{
    public decimal Reduction => VatExempt + Discount;

    public decimal AmountDue => Covered - Reduction;
}

public static class SeniorPwdRules
{
    public const decimal DiscountRate = 0.20m;

    public const decimal VatRate = 0.12m;

    public static SeniorPwdAmounts ForRow(decimal covered, bool vatRegistered)
    {
        if (covered <= 0m)
        {
            return new SeniorPwdAmounts(0m, 0m, 0m);
        }

        if (!vatRegistered)
        {
            return new SeniorPwdAmounts(covered, 0m, Round(covered * DiscountRate));
        }

        var net = Round(covered / (1m + VatRate));
        return new SeniorPwdAmounts(covered, covered - net, Round(net * DiscountRate));
    }

    public static SeniorPwdAmounts ForLine(decimal unitPrice, decimal addOnsPerUnit, int quantity, bool vatRegistered) =>
        ForRow(OrderMetrics.LineTotal(unitPrice, addOnsPerUnit, quantity), vatRegistered);

    public static bool IsEligibleLine(bool productEligible, bool hasPromotion, bool isBundle) =>
        productEligible && !hasPromotion && !isBundle;

    public static string NormalizeIdNumber(string? idNumber) =>
        (idNumber ?? string.Empty).Trim().Replace(" ", string.Empty).ToUpperInvariant();

    // Two spellings of one card (SC-123, sc123, SC 123) must count as the same person for the one-discount-a-day check.
    public static string IdKey(string? idNumber) => NormalizeIdNumber(idNumber).Replace("-", string.Empty);

    public static bool IsAvailable(bool enabled, bool hasPermission) => enabled && hasPermission;

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);
}
