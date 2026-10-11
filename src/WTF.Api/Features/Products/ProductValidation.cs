using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

internal static class ProductValidation
{
    public static void EnsureValidCategory(ProductCategoryEnum category, ProductSubCategoryEnum? subCategory)
    {
        if (!Enum.IsDefined(category))
        {
            throw new InvalidOperationException("Product category is not valid.");
        }

        if (subCategory.HasValue && !Enum.IsDefined(subCategory.Value))
        {
            throw new InvalidOperationException("Product sub-category is not valid.");
        }
    }

    public static string NormalizeCode(string code)
    {
        return ProductMapping.NormalizeCode(code);
    }

    public static async Task EnsureUniqueCodeAsync(WTFDbContext db, string code, Guid? excludeId = null, CancellationToken cancellationToken = default)
    {
        var normalizedCode = NormalizeCode(code);
        var codeExists = excludeId.HasValue
            ? await db.Products.AnyAsync(p => p.Code == normalizedCode && p.Id != excludeId.Value, cancellationToken)
            : await db.Products.AnyAsync(p => p.Code == normalizedCode, cancellationToken);

        if (codeExists)
        {
            throw new InvalidOperationException("Product code already exists.");
        }
    }
}
