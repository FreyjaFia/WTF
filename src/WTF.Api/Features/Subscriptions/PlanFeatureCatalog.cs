using WTF.Calculations.Subscriptions;

namespace WTF.Api.Features.Subscriptions;

public sealed record PlanFeatureText(string Label, string Description, string Group);

public sealed record PlanFeatureEntry(string Key, string Label, string Description, string Group, IReadOnlyList<string> Needs);

public static class PlanFeatureCatalog
{
    private static readonly Dictionary<string, PlanFeatureText> Texts = new(StringComparer.OrdinalIgnoreCase)
    {
        [PlanFeatures.Expenses] = new("Expenses", "Record and review shop expenses.", "Money"),
        [PlanFeatures.Inventory] = new("Inventory", "Items, stock, counts, waste and costs.", "Stock"),
        [PlanFeatures.Purchasing] = new("Purchasing", "Suppliers, reorder list, purchase orders and receiving.", "Stock"),
        [PlanFeatures.Promotions] = new("Promotions", "Discounts and deals on the register.", "Sell more"),
        [PlanFeatures.OrderLinks] = new("Order links", "Customer ordering links.", "Customer ordering"),
        [PlanFeatures.Chat] = new("Order chat", "Chat with customers about their orders.", "Customer ordering"),
        [PlanFeatures.Workbook] = new("Monthly workbook", "The monthly Excel report workbook.", "Insight"),
        [PlanFeatures.Audit] = new("Audit log", "See who changed what.", "Control"),
        [PlanFeatures.CustomRoles] = new("Custom roles", "Create your own roles and choose what each can do.", "Control")
    };

    public static IReadOnlyList<PlanFeatureEntry> Entries { get; } =
    [
        .. PlanFeatures.Catalog.Select(f => new PlanFeatureEntry(f.Key, Texts[f.Key].Label, Texts[f.Key].Description, Texts[f.Key].Group, f.Needs))
    ];

    public static string LabelOf(string key) => Texts.TryGetValue(key, out var text) ? text.Label : key;

    public static bool HasText(string key) => Texts.ContainsKey(key);
}
