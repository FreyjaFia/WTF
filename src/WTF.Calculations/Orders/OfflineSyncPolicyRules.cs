namespace WTF.Calculations.Orders;

public readonly record struct OfflineSyncPolicySnapshot(
    IReadOnlySet<string> NoteCodes,
    decimal PriceTolerance,
    bool AutoApproveNotes,
    int AgedAfterDays)
{
    public static OfflineSyncPolicySnapshot Default { get; } = new(
        new HashSet<string>(),
        OfflineSyncPolicyRules.DefaultPriceTolerance,
        false,
        OfflineSyncPolicyRules.DefaultAgedAfterDays);
}

public static class OfflineSyncPolicyRules
{
    public const decimal DefaultPriceTolerance = 0m;

    public const decimal MaxPriceTolerance = 1000m;

    public const int DefaultAgedAfterDays = 2;

    public const int MinAgedAfterDays = 1;

    public const int MaxAgedAfterDays = 30;

    private const string SeniorPwdPrefix = "SeniorPwd";

    private static readonly HashSet<string> PriceCodes = new(StringComparer.Ordinal) { "PriceChanged", "AddOnPriceChanged" };

    public static IReadOnlyList<string> ConfigurableCodes { get; } =
    [
        "PriceChanged",
        "AddOnPriceChanged",
        "ProductInactive",
        "BundleChanged",
        "CustomerInactive",
        "PromotionEnded",
        "UnknownProduct"
    ];

    public static bool IsSeniorPwdCode(string code) => code.StartsWith(SeniorPwdPrefix, StringComparison.Ordinal);

    public static bool IsConfigurable(string code) => ConfigurableCodes.Contains(code);

    public static bool IsWithinTolerance(decimal difference, decimal tolerance) =>
        tolerance > 0m && Math.Abs(difference) <= tolerance;

    public static bool IsValidTolerance(decimal tolerance) => tolerance is >= 0m and <= MaxPriceTolerance;

    public static bool IsValidAgedAfterDays(int days) => days is >= MinAgedAfterDays and <= MaxAgedAfterDays;

    // A finding can only get softer through the policy, never harder: a Note stays a Note. A Senior/PWD finding is a tax
    // record and ignores the policy, and a code outside the configurable list (a promotion that now covers only part of a
    // line, for example) keeps the severity the review gave it.
    public static bool StaysHold(string code, bool isHold, decimal? unitPriceDifference, OfflineSyncPolicySnapshot policy)
    {
        if (!isHold || IsSeniorPwdCode(code) || !IsConfigurable(code))
        {
            return isHold;
        }

        if (PriceCodes.Contains(code) && unitPriceDifference.HasValue && IsWithinTolerance(unitPriceDifference.Value, policy.PriceTolerance))
        {
            return false;
        }

        return !policy.NoteCodes.Contains(code);
    }

    public static bool IsAged(DateTime heldSince, DateTime now, int agedAfterDays) =>
        now - heldSince > TimeSpan.FromDays(agedAfterDays);
}
