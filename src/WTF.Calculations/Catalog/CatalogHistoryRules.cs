using System.Globalization;
using System.Security.Cryptography;

namespace WTF.Calculations.Catalog;

public sealed record CatalogFieldChange(DateTime EffectiveFrom, DateTime CreatedAt, string? OldValue, string? NewValue);

public sealed record CatalogFieldDiff(string Field, string? OldValue, string? NewValue);

public static class CatalogHistoryRules
{
    public const string CreatedField = "Created";

    public const string BaselineField = "LogStarted";

    public static string? Format(decimal? value) =>
        value?.ToString("0.00####", CultureInfo.InvariantCulture);

    public static string? Format(bool? value) =>
        value is null ? null : value.Value ? "true" : "false";

    public static string? Format(int? value) =>
        value?.ToString(CultureInfo.InvariantCulture);

    public static string? Format(DateTime? value) =>
        value?.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture);

    public static string? Format(TimeOnly? value) =>
        value?.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    public static decimal? ParseDecimal(string? value) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    public static bool? ParseBool(string? value) =>
        bool.TryParse(value, out var parsed) ? parsed : null;

    public static Guid AddOnOverrideKey(Guid productId, Guid addOnId)
    {
        Span<byte> input = stackalloc byte[32];
        productId.TryWriteBytes(input[..16]);
        addOnId.TryWriteBytes(input[16..]);
        Span<byte> hash = stackalloc byte[16];
        MD5.HashData(input, hash);
        return new Guid(hash);
    }

    public static List<CatalogFieldDiff> Diff(
        IReadOnlyDictionary<string, string?> before,
        IReadOnlyDictionary<string, string?> after)
    {
        var diffs = new List<CatalogFieldDiff>();
        foreach (var field in before.Keys.Union(after.Keys).Order(StringComparer.Ordinal))
        {
            before.TryGetValue(field, out var oldValue);
            after.TryGetValue(field, out var newValue);
            if (!string.Equals(oldValue, newValue, StringComparison.Ordinal))
            {
                diffs.Add(new CatalogFieldDiff(field, oldValue, newValue));
            }
        }

        return diffs;
    }

    public static string? ValueAsOf(string? currentValue, IEnumerable<CatalogFieldChange> changes, DateTime asOf)
    {
        var next = changes
            .Where(c => c.EffectiveFrom > asOf)
            .OrderBy(c => c.EffectiveFrom)
            .ThenBy(c => c.CreatedAt)
            .FirstOrDefault();

        return next is null ? currentValue : next.OldValue;
    }

    public static List<T> Between<T>(IEnumerable<T> changes, Func<T, DateTime> effectiveFrom, DateTime after, DateTime before) =>
        [.. changes.Where(c => effectiveFrom(c) > after && effectiveFrom(c) <= before).OrderBy(effectiveFrom)];

    public static bool CoversSince(bool hasCreatedRow, DateTime? baselineFrom, DateTime since) =>
        hasCreatedRow || (baselineFrom is { } start && start <= since);
}
