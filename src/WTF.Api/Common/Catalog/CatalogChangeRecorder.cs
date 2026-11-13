using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Common.Catalog;

public static class CatalogEntityTypes
{
    public const string Product = "Product";
    public const string AddOnPriceOverride = "ProductAddOnPriceOverride";
    public const string Promotion = "Promotion";
    public const string TenantSettings = "TenantSettings";
    public const string Baseline = "Baseline";
}

// Every row says "this field changed at EffectiveFrom". EffectiveFrom is always the moment the change was saved, also when
// the field itself is a future start or end date of a promotion (the date is the value). Rows are only added to the same
// SaveChanges as the change, so the log and the data commit or roll back together.
internal static class CatalogChangeRecorder
{
    private static readonly string[] ProductFields = [nameof(Product.Price), nameof(Product.IsActive), nameof(Product.IsSeniorPwdEligible)];

    private static readonly string[] OverrideFields = [nameof(ProductAddOnPriceOverride.Price), nameof(ProductAddOnPriceOverride.IsActive)];

    private static readonly string[] SettingsFields = [nameof(TenantSetting.SeniorPwdEnabled), nameof(TenantSetting.VatRegistered)];

    public static void Record(
        WTFDbContext db,
        string entityType,
        Guid entityId,
        string field,
        string? oldValue,
        string? newValue,
        Guid? changedBy,
        DateTime? at = null)
    {
        if (string.Equals(oldValue, newValue, StringComparison.Ordinal))
        {
            return;
        }

        Add(db, [(entityType, entityId, new CatalogFieldDiff(field, oldValue, newValue))], changedBy, at);
    }

    public static void RecordProduct(WTFDbContext db, Product product, Guid? changedBy)
    {
        RecordEntry(db, db.Entry(product), CatalogEntityTypes.Product, product.Id, ProductFields, null, changedBy);
    }

    public static void RecordAddOnOverride(WTFDbContext db, ProductAddOnPriceOverride addOnOverride, Guid? changedBy)
    {
        var key = CatalogHistoryRules.AddOnOverrideKey(addOnOverride.ProductId, addOnOverride.AddOnId);
        RecordEntry(db, db.Entry(addOnOverride), CatalogEntityTypes.AddOnPriceOverride, key, OverrideFields, null, changedBy);
    }

    public static void RecordTenantSettings(WTFDbContext db, TenantSetting settings, Guid? changedBy)
    {
        var defaults = SettingsFields.ToDictionary(f => f, _ => (string?)CatalogHistoryRules.Format(false));
        RecordEntry(db, db.Entry(settings), CatalogEntityTypes.TenantSettings, settings.TenantId, SettingsFields, defaults, changedBy, markCreated: false);
    }

    public static void RecordBaseline(WTFDbContext db, Guid tenantId, DateTime? at = null)
    {
        Add(db, [(CatalogEntityTypes.Baseline, tenantId, new CatalogFieldDiff(CatalogHistoryRules.BaselineField, null, "1"))], null, at, tenantId);
    }

    public static Dictionary<string, string?> SnapshotPromotion(Promotion promotion)
    {
        var fields = new Dictionary<string, string?>
        {
            [nameof(Promotion.IsActive)] = CatalogHistoryRules.Format(promotion.IsActive),
            [nameof(Promotion.StartDate)] = CatalogHistoryRules.Format(promotion.StartDate),
            [nameof(Promotion.EndDate)] = CatalogHistoryRules.Format(promotion.EndDate),
            [nameof(Promotion.DaysOfWeek)] = CatalogHistoryRules.Format(promotion.DaysOfWeek),
            [nameof(Promotion.StartTime)] = CatalogHistoryRules.Format(promotion.StartTime),
            [nameof(Promotion.EndTime)] = CatalogHistoryRules.Format(promotion.EndTime),
            [nameof(Promotion.MaxRedemptions)] = CatalogHistoryRules.Format(promotion.MaxRedemptions),
            [nameof(Promotion.MaxPerOrder)] = CatalogHistoryRules.Format(promotion.MaxPerOrder),
        };

        foreach (var group in promotion.DiscountedProductPromotions.GroupBy(x => x.ProductId))
        {
            fields[$"Rule:{group.Key}"] = string.Join("|", group.Select(x => Join(
                x.FixedPrice is null ? null : $"fixed={CatalogHistoryRules.Format(x.FixedPrice)}",
                x.PercentOff is null ? null : $"percent={CatalogHistoryRules.Format(x.PercentOff)}",
                $"addons={AddOns(x.DiscountedProductPromotionAddOns.Select(a => (a.AddOnProductId, a.Quantity)))}")));
        }

        if (promotion.FixedBundlePromotion is { } bundle)
        {
            fields["BundlePrice"] = CatalogHistoryRules.Format(bundle.BundlePrice);
            foreach (var group in bundle.FixedBundlePromotionItems.GroupBy(x => x.ProductId))
            {
                fields[$"Item:{group.Key}"] = string.Join("|", group.Select(x => Join(
                    $"qty={x.Quantity}",
                    $"addons={AddOns(x.FixedBundlePromotionItemAddOns.Select(a => (a.AddOnProductId, a.Quantity)))}")));
            }
        }

        if (promotion.MixMatchPromotion is { } mixMatch)
        {
            fields["BundlePrice"] = CatalogHistoryRules.Format(mixMatch.BundlePrice);
            fields["RequiredQuantity"] = CatalogHistoryRules.Format(mixMatch.RequiredQuantity);
            fields["MaxSelectionsPerOrder"] = CatalogHistoryRules.Format(mixMatch.MaxSelectionsPerOrder);
            foreach (var group in mixMatch.MixMatchPromotionProducts.GroupBy(x => x.ProductId))
            {
                fields[$"Item:{group.Key}"] = string.Join("|", group.Select(x =>
                    $"addons={AddOns(x.MixMatchPromotionProductAddOns.Select(a => (a.AddOnProductId, a.Quantity)))}"));
            }
        }

        return fields;
    }

    public static void RecordPromotion(
        WTFDbContext db,
        Promotion promotion,
        IReadOnlyDictionary<string, string?>? before,
        Guid? changedBy)
    {
        Guard(() =>
        {
            var diffs = CatalogHistoryRules.Diff(before ?? new Dictionary<string, string?>(), SnapshotPromotion(promotion));
            if (before is null)
            {
                diffs.Insert(0, new CatalogFieldDiff(CatalogHistoryRules.CreatedField, null, "1"));
            }

            Add(db, [.. diffs.Select(d => (CatalogEntityTypes.Promotion, promotion.Id, d))], changedBy, null);
        });
    }

    private static void RecordEntry(
        WTFDbContext db,
        EntityEntry entry,
        string entityType,
        Guid entityId,
        string[] fields,
        Dictionary<string, string?>? beforeWhenAdded,
        Guid? changedBy,
        bool markCreated = true)
    {
        Guard(() =>
        {
            var added = entry.State == EntityState.Added;
            var before = added
                ? beforeWhenAdded ?? []
                : fields.ToDictionary(f => f, f => Text(entry.OriginalValues[f]));
            var after = fields.ToDictionary(f => f, f => Text(entry.CurrentValues[f]));

            var diffs = CatalogHistoryRules.Diff(before, after);
            if (added && markCreated)
            {
                diffs.Insert(0, new CatalogFieldDiff(CatalogHistoryRules.CreatedField, null, "1"));
            }

            Add(db, [.. diffs.Select(d => (entityType, entityId, d))], changedBy, null);
        });
    }

    private static void Add(
        WTFDbContext db,
        IReadOnlyList<(string EntityType, Guid EntityId, CatalogFieldDiff Diff)> changes,
        Guid? changedBy,
        DateTime? at,
        Guid? tenantId = null)
    {
        if (changes.Count == 0)
        {
            return;
        }

        Guard(() =>
        {
            var now = at ?? DateTime.UtcNow;
            db.CatalogChangeLogs.AddRange(changes.Select(c => new CatalogChangeLog
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId ?? Guid.Empty,
                EntityType = c.EntityType,
                EntityId = c.EntityId,
                Field = c.Diff.Field,
                OldValue = c.Diff.OldValue,
                NewValue = c.Diff.NewValue,
                EffectiveFrom = now,
                ChangedBy = changedBy,
                CreatedAt = now,
            }));
        });
    }

    private static void Guard(Action write)
    {
        try
        {
            write();
        }
        catch (Exception)
        {
            // A catalog change is never refused for its log row; a missing row only sends the review back to today's behavior.
        }
    }

    private static string? Text(object? value) => value switch
    {
        null => null,
        decimal d => CatalogHistoryRules.Format(d),
        bool b => CatalogHistoryRules.Format(b),
        byte b => CatalogHistoryRules.Format((int)b),
        int i => CatalogHistoryRules.Format(i),
        DateTime d => CatalogHistoryRules.Format(d),
        TimeOnly t => CatalogHistoryRules.Format(t),
        _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
    };

    private static string Join(params string?[] parts) => string.Join(";", parts.Where(p => p is not null));

    private static string AddOns(IEnumerable<(Guid AddOnProductId, int Quantity)> addOns) =>
        string.Join(",", addOns.OrderBy(a => a.AddOnProductId).Select(a => $"{a.AddOnProductId}*{a.Quantity}"));
}
