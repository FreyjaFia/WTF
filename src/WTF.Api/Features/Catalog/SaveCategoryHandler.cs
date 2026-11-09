using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Catalog;

public record SaveCategoryCommand(int? Id, string Name, int SortOrder) : IRequest<int>;

public record SetCategoryActiveCommand(int Id, bool IsActive) : IRequest;

public class SaveCategoryHandler(WTFDbContext db, IAuditService audit) : IRequestHandler<SaveCategoryCommand, int>
{
    public async Task<int> Handle(SaveCategoryCommand request, CancellationToken cancellationToken)
    {
        var name = CatalogNames.Clean(request.Name, "Category");

        if (await db.ProductCategories.AnyAsync(c => c.Id != request.Id && c.Name == name, cancellationToken))
        {
            throw new InvalidOperationException($"A category named \"{name}\" already exists.");
        }

        ProductCategory category;
        IDbContextTransaction? idTransaction = null;
        if (request.Id is null)
        {
            idTransaction = await CatalogIdLock.AcquireAsync(db, cancellationToken);
            var nextId = (await db.ProductCategories.IgnoreQueryFilters().MaxAsync(c => (int?)c.Id, cancellationToken) ?? 0) + 1;
            category = new ProductCategory { Id = nextId, IsActive = true, CreatedAt = DateTime.UtcNow };
            db.ProductCategories.Add(category);
        }
        else
        {
            category = await db.ProductCategories.FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken)
                ?? throw new KeyNotFoundException("Category not found.");
            category.UpdatedAt = DateTime.UtcNow;
        }

        category.Name = name;
        category.SortOrder = request.SortOrder;

        await db.SaveChangesAsync(cancellationToken);
        if (idTransaction is not null)
        {
            await idTransaction.CommitAsync(cancellationToken);
            await idTransaction.DisposeAsync();
        }

        await audit.LogAsync(AuditAction.CatalogCategorySaved, AuditEntityType.CatalogEntry, $"category:{category.Id}",
            newValues: new { category.Id, category.Name, category.SortOrder }, cancellationToken: cancellationToken);

        return category.Id;
    }
}

public class SetCategoryActiveHandler(WTFDbContext db, IAuditService audit) : IRequestHandler<SetCategoryActiveCommand>
{
    public async Task Handle(SetCategoryActiveCommand request, CancellationToken cancellationToken)
    {
        // The count and the change must not be split by a product that is moved onto this category in between.
        await using var guard = !request.IsActive && db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken)
            : null;

        var category = await db.ProductCategories.FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Category not found.");

        if (!request.IsActive)
        {
            var used = await db.Products.CountAsync(p => p.IsActive && p.CategoryId == request.Id, cancellationToken);
            if (used > 0)
            {
                throw new InvalidOperationException($"{used} active product(s) still use this category. Move them first.");
            }
        }

        category.IsActive = request.IsActive;
        category.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(cancellationToken);
        if (guard is not null)
        {
            await guard.CommitAsync(cancellationToken);
        }

        await audit.LogAsync(AuditAction.CatalogCategorySaved, AuditEntityType.CatalogEntry, $"category:{category.Id}",
            newValues: new { category.Id, category.IsActive }, cancellationToken: cancellationToken);
    }
}
