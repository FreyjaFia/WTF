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

    // The covered amount is the VAT-inclusive list price of a row (an item, its add-ons and its quantity). A VAT-registered
    // shop takes the discount off the price without VAT and does not charge the VAT; any other shop takes 20% off the price.
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

    // A promotion price and a bundle are never covered, and neither is a product the shop marked as not food or drink.
    public static bool IsEligibleLine(bool productEligible, bool hasPromotion, bool isBundle) =>
        productEligible && !hasPromotion && !isBundle;

    public static bool IsAvailable(bool enabled, bool hasPermission) => enabled && hasPermission;

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);
}
