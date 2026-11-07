using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

internal static class ProductValidation
{
    public static async Task EnsureValidCategoryAsync(
        WTFDbContext db, int category, int? subCategory, int? currentCategory, int? currentSubCategory, CancellationToken cancellationToken)
    {
        var categoryRow = await db.ProductCategories.AsNoTracking()
            .Where(c => c.Id == category).Select(c => new { c.IsActive }).FirstOrDefaultAsync(cancellationToken);
        if (categoryRow is null || (!categoryRow.IsActive && category != currentCategory))
        {
            throw new InvalidOperationException("Product category is not valid.");
        }

        if (subCategory.HasValue)
        {
            var subRow = await db.ProductSubCategories.AsNoTracking()
                .Where(s => s.Id == subCategory.Value).Select(s => new { s.IsActive }).FirstOrDefaultAsync(cancellationToken);
            if (subRow is null || (!subRow.IsActive && subCategory != currentSubCategory))
            {
                throw new InvalidOperationException("Product sub-category is not valid.");
            }
        }
    }

    public static async Task EnsureValidAddOnTypesAsync(WTFDbContext db, IEnumerable<int> typeIds, CancellationToken cancellationToken)
    {
        var distinct = typeIds.Distinct().ToList();
        var active = await db.AddOnTypes.AsNoTracking().CountAsync(t => distinct.Contains(t.Id) && t.IsActive, cancellationToken);
        if (active != distinct.Count)
        {
            throw new InvalidOperationException("One or more add-ons have an invalid type.");
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
