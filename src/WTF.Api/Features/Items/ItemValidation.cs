using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

internal static class ItemValidation
{
    // Mirrors INVENTORY_UNIT_OPTIONS in the POS until units live in their own table (see the roadmap, "Setup lists").
    public static readonly IReadOnlyList<string> Units =
    [
        "piece", "box", "pack", "case", "bottle", "carton", "cup", "lid", "sleeve", "liter", "milliliter", "kilogram", "gram"
    ];

    public static async Task ValidateUniqueSkuAndBarcode(
        WTFDbContext db,
        string? sku,
        string? barcode,
        Guid? currentId,
        CancellationToken cancellationToken)
    {
        var normalizedSku = NormalizeOptional(sku);
        if (normalizedSku is not null)
        {
            var skuExists = await db.Items.AnyAsync(
                i => i.Sku == normalizedSku && (!currentId.HasValue || i.Id != currentId.Value),
                cancellationToken);
            if (skuExists)
            {
                throw new InvalidOperationException("Item SKU already exists.");
            }
        }

        var normalizedBarcode = NormalizeOptional(barcode);
        if (normalizedBarcode is not null)
        {
            var barcodeExists = await db.Items.AnyAsync(
                i => i.Barcode == normalizedBarcode && (!currentId.HasValue || i.Id != currentId.Value),
                cancellationToken);
            if (barcodeExists)
            {
                throw new InvalidOperationException("Item barcode already exists.");
            }
        }
    }

    public static string NormalizeUnit(string? value)
    {
        var unit = Units.FirstOrDefault(u => string.Equals(u, value?.Trim(), StringComparison.OrdinalIgnoreCase));
        return unit ?? throw new InvalidOperationException($"Unit must be one of: {string.Join(", ", Units)}.");
    }

    public static string? NormalizeOptionalUnit(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : NormalizeUnit(value);
    }

    public static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
