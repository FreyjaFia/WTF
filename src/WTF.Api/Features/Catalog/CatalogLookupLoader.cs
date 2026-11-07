using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Catalog.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Catalog;

internal static class CatalogLookupLoader
{
    public static async Task<CatalogLookupsDto> LoadAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        var categories = await db.ProductCategories.AsNoTracking()
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
            .Select(c => new CategoryLookupDto(c.Id, c.Name, c.SortOrder, c.IsActive))
            .ToListAsync(cancellationToken);

        var subCategories = await db.ProductSubCategories.AsNoTracking()
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Name)
            .Select(s => new SubCategoryLookupDto(s.Id, s.Name, s.CategoryId, s.SortOrder, s.IsActive))
            .ToListAsync(cancellationToken);

        var addOnTypes = await db.AddOnTypes.AsNoTracking()
            .OrderBy(t => t.SortOrder).ThenBy(t => t.Name)
            .Select(t => new AddOnTypeLookupDto(t.Id, t.Name, t.IsRequired, t.MinSelect, t.MaxSelect, t.SortOrder, t.IsActive))
            .ToListAsync(cancellationToken);

        return new CatalogLookupsDto(categories, subCategories, addOnTypes);
    }
}
