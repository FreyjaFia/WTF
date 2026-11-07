namespace WTF.Api.Features.Catalog;

internal static class CatalogNames
{
    public const int MaxLength = 50;

    public static string Clean(string? name, string label)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            throw new ArgumentException($"{label} name is required.");
        }

        if (trimmed.Length > MaxLength)
        {
            throw new ArgumentException($"{label} name cannot be longer than {MaxLength} characters.");
        }

        return trimmed;
    }
}
