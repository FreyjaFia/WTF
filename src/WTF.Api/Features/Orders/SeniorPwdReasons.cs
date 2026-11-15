using WTF.Calculations.Orders;

namespace WTF.Api.Features.Orders;

internal static class SeniorPwdReasons
{
    public static string? Ineligible(string productName, bool productEligible, bool hasPromotion, bool isBundle)
    {
        if (SeniorPwdRules.IsEligibleLine(productEligible, hasPromotion, isBundle))
        {
            return null;
        }

        var reason = !productEligible
            ? "is not food or drink, so it cannot take the Senior/PWD discount"
            : isBundle
                ? "is part of a bundle, so it cannot take the Senior/PWD discount"
                : "already has a promotion price, so it cannot take the Senior/PWD discount";
        return $"{productName} {reason}.";
    }
}
