using System.Globalization;

namespace WTF.Api.Common.Orders;

/// <summary>Builds the label saved with an order line for the promotion that was applied to it.</summary>
public static class PromotionLabelFormatter
{
    // Same priority as the price calculation: a fixed amount wins over a percentage.
    public static string? Format(decimal? fixedAmount, decimal? percentOff)
    {
        if (fixedAmount is > 0)
        {
            return $"Promo -\u20B1{fixedAmount.Value.ToString("N2", CultureInfo.InvariantCulture)}";
        }

        if (percentOff is > 0)
        {
            return $"Promo -{percentOff.Value.ToString("0.##", CultureInfo.InvariantCulture)}%";
        }

        return null;
    }
}
