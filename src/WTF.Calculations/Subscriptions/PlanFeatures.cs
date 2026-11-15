namespace WTF.Calculations.Subscriptions;

public sealed record PlanFeatureDefinition(string Key, string Label, string Description, string Group, IReadOnlyList<string> Needs);

// Which features a plan holds and how that narrows what a role can do. The catalog is the only source of valid feature
// keys; "core" is in every plan and cannot be switched. Which keys a plan holds is data (Plans.Features, a comma list).
// Words that are not in the catalog (the older "pos,orders,reports,offline") are ignored when a plan is read.
public static class PlanFeatures
{
    public const string Core = "core";
    public const string Expenses = "expenses";
    public const string Inventory = "inventory";
    public const string Purchasing = "purchasing";
    public const string Promotions = "promotions";
    public const string OrderLinks = "orderlinks";
    public const string Chat = "chat";
    public const string Workbook = "workbook";
    public const string Audit = "audit";
    public const string CustomRoles = "customroles";

    public static readonly IReadOnlyList<PlanFeatureDefinition> Catalog =
    [
        new(Expenses, "Expenses", "Record and review shop expenses.", "Money", []),
        new(Inventory, "Inventory", "Items, stock, counts, waste and costs.", "Stock", []),
        new(Purchasing, "Purchasing", "Suppliers, reorder list, purchase orders and receiving.", "Stock", [Inventory]),
        new(Promotions, "Promotions", "Discounts and deals on the register.", "Sell more", []),
        new(OrderLinks, "Order links", "Customer ordering links.", "Customer ordering", []),
        new(Chat, "Order chat", "Chat with customers about their orders.", "Customer ordering", [OrderLinks]),
        new(Workbook, "Monthly workbook", "The monthly Excel report workbook.", "Insight", []),
        new(Audit, "Audit log", "See who changed what.", "Control", []),
        new(CustomRoles, "Custom roles", "Create your own roles and choose what each can do.", "Control", [])
    ];

    public static readonly IReadOnlyList<string> Gateable = [.. Catalog.Select(f => f.Key)];

    public static bool IsKnown(string key) => Gateable.Contains(key, StringComparer.OrdinalIgnoreCase);

    public static PlanFeatureDefinition? Find(string key) =>
        Catalog.FirstOrDefault(f => string.Equals(f.Key, key, StringComparison.OrdinalIgnoreCase));

    public static HashSet<string> Parse(string? planFeatures)
    {
        var features = new HashSet<string>(Normalize(Split(planFeatures)), StringComparer.OrdinalIgnoreCase) { Core };
        return features;
    }

    public static IReadOnlyList<string> Split(string? planFeatures) =>
        [.. (planFeatures ?? string.Empty).Split([',', ';', '\n', '\r', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)];

    // Drops words that are not in the catalog and adds what each feature needs. The result is in catalog order and never
    // holds "core".
    public static List<string> Normalize(IEnumerable<string> words)
    {
        var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pending = new Stack<string>(words.Where(IsKnown).Select(w => w.ToLowerInvariant()));

        while (pending.Count > 0)
        {
            var key = pending.Pop();
            if (!wanted.Add(key))
            {
                continue;
            }

            foreach (var needed in Find(key)!.Needs)
            {
                pending.Push(needed);
            }
        }

        return [.. Gateable.Where(wanted.Contains)];
    }

    public static IReadOnlyList<string> Unknown(IEnumerable<string> words) =>
        [.. words.Where(w => !IsKnown(w)).Select(w => w.ToLowerInvariant()).Distinct()];

    public static string Serialize(IEnumerable<string> words) => string.Join(",", Normalize(words));

    public static HashSet<string> All() => new(Gateable.Append(Core), StringComparer.OrdinalIgnoreCase);

    public static bool IsAllowed(string feature, IReadOnlySet<string> planFeatures) => planFeatures.Contains(feature);

    // The plans that hold a feature, cheapest first as given, for the "Available in Pro" text.
    public static IReadOnlyList<string> PlansContaining(string feature, IEnumerable<(string Name, string? Features)> plans) =>
        [.. plans.Where(p => Parse(p.Features).Contains(feature)).Select(p => p.Name)];

    public static HashSet<string> Effective(IEnumerable<string> roleKeys, Func<string, string> featureOf, IReadOnlySet<string> planFeatures) =>
        [.. roleKeys.Where(k => IsAllowed(featureOf(k), planFeatures))];
}
