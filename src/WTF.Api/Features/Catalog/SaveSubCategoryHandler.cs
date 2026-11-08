using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Catalog;

public record SaveSubCategoryCommand(int? Id, string Name, int CategoryId, int SortOrder) : IRequest<int>;

public record SetSubCategoryActiveCommand(int Id, bool IsActive) : IRequest;

public class SaveSubCategoryHandler(WTFDbContext db, IAuditService audit) : IRequestHandler<SaveSubCategoryCommand, int>
{
    public async Task<int> Handle(SaveSubCategoryCommand request, CancellationToken cancellationToken)
    {
        var name = CatalogNames.Clean(request.Name, "Sub-category");

        if (!await db.ProductCategories.AnyAsync(c => c.Id == request.CategoryId, cancellationToken))
        {
            throw new ArgumentException("Choose a category for the sub-category.");
        }

        if (await db.ProductSubCategories.AnyAsync(s => s.Id != request.Id && s.Name == name, cancellationToken))
        {
            throw new InvalidOperationException($"A sub-category named \"{name}\" already exists.");
        }

        ProductSubCategory subCategory;
        if (request.Id is null)
        {
            var nextId = (await db.ProductSubCategories.IgnoreQueryFilters().MaxAsync(s => (int?)s.Id, cancellationToken) ?? 0) + 1;
            subCategory = new ProductSubCategory { Id = nextId, IsActive = true, CreatedAt = DateTime.UtcNow };
            db.ProductSubCategories.Add(subCategory);
        }
        else
        {
            subCategory = await db.ProductSubCategories.FirstOrDefaultAsync(s => s.Id == request.Id, cancellationToken)
                ?? throw new KeyNotFoundException("Sub-category not found.");
            subCategory.UpdatedAt = DateTime.UtcNow;
        }

        subCategory.Name = name;
        subCategory.CategoryId = request.CategoryId;
        subCategory.SortOrder = request.SortOrder;

        await db.SaveChangesAsync(cancellationToken);
        await audit.LogAsync(AuditAction.CatalogSubCategorySaved, AuditEntityType.CatalogEntry, $"subcategory:{subCategory.Id}",
            newValues: new { subCategory.Id, subCategory.Name, subCategory.CategoryId, subCategory.SortOrder }, cancellationToken: cancellationToken);

        return subCategory.Id;
    }
}

public class SetSubCategoryActiveHandler(WTFDbContext db, IAuditService audit) : IRequestHandler<SetSubCategoryActiveCommand>
{
    public async Task Handle(SetSubCategoryActiveCommand request, CancellationToken cancellationToken)
    {
        var subCategory = await db.ProductSubCategories.FirstOrDefaultAsync(s => s.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Sub-category not found.");

        if (!request.IsActive)
        {
            var used = await db.Products.CountAsync(p => p.IsActive && p.SubCategoryId == request.Id, cancellationToken);
            if (used > 0)
            {
                throw new InvalidOperationException($"{used} active product(s) still use this sub-category. Move them first.");
            }
        }

        subCategory.IsActive = request.IsActive;
        subCategory.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(cancellationToken);
        await audit.LogAsync(AuditAction.CatalogSubCategorySaved, AuditEntityType.CatalogEntry, $"subcategory:{subCategory.Id}",
            newValues: new { subCategory.Id, subCategory.IsActive }, cancellationToken: cancellationToken);
    }
}
