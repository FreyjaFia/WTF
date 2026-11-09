using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Catalog;

public record SaveAddOnTypeCommand(int? Id, string Name, bool IsRequired, int MinSelect, int MaxSelect, int SortOrder) : IRequest<int>;

public record SetAddOnTypeActiveCommand(int Id, bool IsActive) : IRequest;

public class SaveAddOnTypeHandler(WTFDbContext db, IAuditService audit) : IRequestHandler<SaveAddOnTypeCommand, int>
{
    public async Task<int> Handle(SaveAddOnTypeCommand request, CancellationToken cancellationToken)
    {
        var name = CatalogNames.Clean(request.Name, "Add-on type");

        if (request.MinSelect < 0 || request.MaxSelect < 0)
        {
            throw new ArgumentException("Minimum and maximum selections cannot be negative.");
        }

        var min = request.IsRequired ? Math.Max(request.MinSelect, 1) : request.MinSelect;
        if (request.MaxSelect > 0 && min > request.MaxSelect)
        {
            throw new ArgumentException("The minimum selections cannot be more than the maximum.");
        }

        if (await db.AddOnTypes.AnyAsync(t => t.Id != request.Id && t.Name == name, cancellationToken))
        {
            throw new InvalidOperationException($"An add-on type named \"{name}\" already exists.");
        }

        AddOnType type;
        IDbContextTransaction? idTransaction = null;
        if (request.Id is null)
        {
            idTransaction = await CatalogIdLock.AcquireAsync(db, cancellationToken);
            var nextId = (await db.AddOnTypes.IgnoreQueryFilters().MaxAsync(t => (int?)t.Id, cancellationToken) ?? 0) + 1;
            type = new AddOnType { Id = nextId, IsActive = true, CreatedAt = DateTime.UtcNow };
            db.AddOnTypes.Add(type);
        }
        else
        {
            type = await db.AddOnTypes.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken)
                ?? throw new KeyNotFoundException("Add-on type not found.");
            type.UpdatedAt = DateTime.UtcNow;
        }

        type.Name = name;
        type.IsRequired = request.IsRequired;
        type.MinSelect = min;
        type.MaxSelect = request.MaxSelect;
        type.SortOrder = request.SortOrder;

        await db.SaveChangesAsync(cancellationToken);
        if (idTransaction is not null)
        {
            await idTransaction.CommitAsync(cancellationToken);
            await idTransaction.DisposeAsync();
        }

        await audit.LogAsync(AuditAction.CatalogAddOnTypeSaved, AuditEntityType.CatalogEntry, $"addontype:{type.Id}",
            newValues: new { type.Id, type.Name, type.IsRequired, type.MinSelect, type.MaxSelect, type.SortOrder }, cancellationToken: cancellationToken);

        return type.Id;
    }
}

public class SetAddOnTypeActiveHandler(WTFDbContext db, IAuditService audit) : IRequestHandler<SetAddOnTypeActiveCommand>
{
    public async Task Handle(SetAddOnTypeActiveCommand request, CancellationToken cancellationToken)
    {
        var type = await db.AddOnTypes.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Add-on type not found.");

        if (!request.IsActive)
        {
            if (type.SystemKey == SystemAddOnTypes.SizeKey)
            {
                throw new InvalidOperationException("The Size type is used by ingredient amounts and cannot be switched off.");
            }

            var used = await db.ProductAddOns.Where(pa => pa.IsActive && pa.AddOnTypeId == request.Id)
                .Select(pa => pa.AddOnId).Distinct().CountAsync(cancellationToken);
            if (used > 0)
            {
                throw new InvalidOperationException($"{used} add-on(s) are still linked with this type. Unlink them first.");
            }
        }

        type.IsActive = request.IsActive;
        type.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(cancellationToken);
        await audit.LogAsync(AuditAction.CatalogAddOnTypeSaved, AuditEntityType.CatalogEntry, $"addontype:{type.Id}",
            newValues: new { type.Id, type.IsActive }, cancellationToken: cancellationToken);
    }
}
