using System.Globalization;

namespace WTF.Calculations.Orders;

/// <summary>Builds the label saved with an order line for the promotion that was applied to it.</summary>
public static class PromotionLabelFormatter
{
    // Same priority as the price calculation: a fixed amount wins over a percentage.
    // Given the price the amount comes off, an amount that covers the whole price takes off the price, not the amount set on
    // the promotion (which would claim more than was taken off). It reads "Free" only when nothing else is left to pay; with
    // add-ons still charged it shows what really came off, so "Free" never sits next to a price.
    public static string? Format(decimal? fixedAmount, decimal? percentOff, decimal? basePrice = null, decimal addOnsPerUnit = 0m)
    {
        if (fixedAmount is > 0)
        {
            if (basePrice is > 0 && fixedAmount >= basePrice)
            {
                return addOnsPerUnit > 0
                    ? $"Promo -₱{basePrice.Value.ToString("N2", CultureInfo.InvariantCulture)}"
                    : "Free";
            }

            return $"Promo -\u20B1{fixedAmount.Value.ToString("N2", CultureInfo.InvariantCulture)}";
        }

        if (percentOff is > 0)
        {
            return $"Promo -{percentOff.Value.ToString("0.##", CultureInfo.InvariantCulture)}%";
        }

        return null;
    }
}
