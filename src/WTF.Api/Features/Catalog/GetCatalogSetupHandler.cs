using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Catalog.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Catalog;

public record GetCatalogSetupQuery : IRequest<CatalogSetupDto>;

public class GetCatalogSetupHandler(WTFDbContext db) : IRequestHandler<GetCatalogSetupQuery, CatalogSetupDto>
{
    public async Task<CatalogSetupDto> Handle(GetCatalogSetupQuery request, CancellationToken cancellationToken)
    {
        var categoryCounts = await db.Products
            .Where(p => p.IsActive)
            .GroupBy(p => p.CategoryId)
            .Select(g => new { Id = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Id, x => x.Count, cancellationToken);

        var subCategoryCounts = await db.Products
            .Where(p => p.IsActive && p.SubCategoryId != null)
            .GroupBy(p => p.SubCategoryId!.Value)
            .Select(g => new { Id = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Id, x => x.Count, cancellationToken);

        var addOnTypeCounts = await db.ProductAddOns
            .Where(pa => pa.IsActive && pa.AddOnTypeId != null)
            .GroupBy(pa => pa.AddOnTypeId!.Value)
            .Select(g => new { Id = g.Key, Count = g.Select(x => x.AddOnId).Distinct().Count() })
            .ToDictionaryAsync(x => x.Id, x => x.Count, cancellationToken);

        var subCategories = (await db.ProductSubCategories.AsNoTracking()
                .OrderBy(s => s.SortOrder).ThenBy(s => s.Name)
                .ToListAsync(cancellationToken))
            .Select(s => new SubCategoryDto(s.Id, s.Name, s.CategoryId, s.SortOrder, s.IsActive, subCategoryCounts.GetValueOrDefault(s.Id)))
            .ToList();

        var categories = (await db.ProductCategories.AsNoTracking()
                .OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
                .ToListAsync(cancellationToken))
            .Select(c => new CategoryDto(
                c.Id,
                c.Name,
                c.SortOrder,
                c.IsActive,
                categoryCounts.GetValueOrDefault(c.Id),
                subCategories.Where(s => s.CategoryId == c.Id).ToList()))
            .ToList();

        var addOnTypes = (await db.AddOnTypes.AsNoTracking()
                .OrderBy(t => t.SortOrder).ThenBy(t => t.Name)
                .ToListAsync(cancellationToken))
            .Select(t => new AddOnTypeDto(t.Id, t.Name, t.IsRequired, t.MinSelect, t.MaxSelect, t.SortOrder, t.IsActive, addOnTypeCounts.GetValueOrDefault(t.Id)))
            .ToList();

        return new CatalogSetupDto(categories, subCategories.Where(s => s.CategoryId is null).ToList(), addOnTypes);
    }
}
