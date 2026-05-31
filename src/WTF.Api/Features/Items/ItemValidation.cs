using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

internal static class ItemValidation
{
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

    public static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
