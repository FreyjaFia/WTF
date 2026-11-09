namespace WTF.Calculations.Subscriptions;

// Which features a plan holds and how that narrows what a role can do. The feature codes are the ones the permission
// catalog uses; "core" is in every plan. Unknown words in a plan's list (the older "pos,orders,reports,offline") are ignored.
public static class PlanFeatures
{
    public const string Core = "core";

    public static readonly IReadOnlyList<string> Gateable = ["inventory", "promotions", "orderlinks", "chat", "workbook"];

    public static HashSet<string> Parse(string? planFeatures)
    {
        var features = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Core };
        foreach (var word in (planFeatures ?? string.Empty).Split([',', ';', '\n', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (Gateable.Contains(word, StringComparer.OrdinalIgnoreCase))
            {
                features.Add(word.ToLowerInvariant());
            }
        }

        return features;
    }

    public static HashSet<string> All() => new(Gateable.Append(Core), StringComparer.OrdinalIgnoreCase);

    public static bool IsAllowed(string feature, IReadOnlySet<string> planFeatures) => planFeatures.Contains(feature);

    public static HashSet<string> Effective(IEnumerable<string> roleKeys, Func<string, string> featureOf, IReadOnlySet<string> planFeatures) =>
        [.. roleKeys.Where(k => IsAllowed(featureOf(k), planFeatures))];
}
