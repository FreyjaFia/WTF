using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Platform;

public static class TenantCatalogTemplate
{
    public static async Task CopyAsync(WTFDbContext db, Guid targetTenantId, Guid createdBy, CancellationToken cancellationToken)
    {
        var sourceId = TenantDefaults.DefaultTenantId;
        if (sourceId == targetTenantId)
        {
            return;
        }

        var categories = await db.ProductCategories.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.TenantId == sourceId && c.IsActive).OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync(cancellationToken);
        var subCategories = await db.ProductSubCategories.IgnoreQueryFilters().AsNoTracking()
            .Where(s => s.TenantId == sourceId && s.IsActive).OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToListAsync(cancellationToken);
        var addOnTypes = await db.AddOnTypes.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.TenantId == sourceId && t.IsActive).OrderBy(t => t.SortOrder).ThenBy(t => t.Id).ToListAsync(cancellationToken);
        var wasteReasons = await db.WasteReasons.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.TenantId == sourceId && r.IsActive).OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;

        // Catalog ids are chosen by the app and are unique across all shops, so a copy continues after the highest id in use.
        var nextCategoryId = (await db.ProductCategories.IgnoreQueryFilters().MaxAsync(c => (int?)c.Id, cancellationToken) ?? 0) + 1;
        var categoryIds = new Dictionary<int, int>();
        foreach (var category in categories)
        {
            categoryIds[category.Id] = nextCategoryId;
            db.ProductCategories.Add(new ProductCategory
            {
                Id = nextCategoryId++,
                TenantId = targetTenantId,
                Name = category.Name,
                SortOrder = category.SortOrder,
                IsActive = true,
                CreatedAt = now
            });
        }

        var nextSubCategoryId = (await db.ProductSubCategories.IgnoreQueryFilters().MaxAsync(s => (int?)s.Id, cancellationToken) ?? 0) + 1;
        foreach (var subCategory in subCategories)
        {
            db.ProductSubCategories.Add(new ProductSubCategory
            {
                Id = nextSubCategoryId++,
                TenantId = targetTenantId,
                Name = subCategory.Name,
                SortOrder = subCategory.SortOrder,
                IsActive = true,
                CategoryId = subCategory.CategoryId is { } oldId && categoryIds.TryGetValue(oldId, out var newId) ? newId : null,
                CreatedAt = now
            });
        }

        var nextTypeId = (await db.AddOnTypes.IgnoreQueryFilters().MaxAsync(t => (int?)t.Id, cancellationToken) ?? 0) + 1;
        foreach (var type in addOnTypes)
        {
            db.AddOnTypes.Add(new AddOnType
            {
                Id = nextTypeId++,
                TenantId = targetTenantId,
                Name = type.Name,
                SystemKey = type.SystemKey,
                IsRequired = type.IsRequired,
                MinSelect = type.MinSelect,
                MaxSelect = type.MaxSelect,
                SortOrder = type.SortOrder,
                IsActive = true,
                CreatedAt = now
            });
        }

        foreach (var reason in wasteReasons)
        {
            db.WasteReasons.Add(new WasteReason
            {
                TenantId = targetTenantId,
                Name = reason.Name,
                RequiresNote = reason.RequiresNote,
                SortOrder = reason.SortOrder,
                IsActive = true,
                IsSystem = reason.IsSystem,
                CreatedAt = now,
                CreatedBy = createdBy
            });
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
