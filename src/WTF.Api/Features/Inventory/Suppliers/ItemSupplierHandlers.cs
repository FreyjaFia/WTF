using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Suppliers;

public record GetItemSuppliersQuery(Guid ItemId) : IRequest<List<ItemSupplierDto>?>;

public record SaveItemSupplierCommand : IRequest<List<ItemSupplierDto>?>
{
    public Guid ItemId { get; init; }

    public Guid SupplierId { get; init; }

    [StringLength(50)]
    public string? SupplierItemCode { get; init; }

    [StringLength(50)]
    public string? PackName { get; init; }

    [Range(0.001, 999999.999)]
    public decimal UnitsPerPack { get; init; } = 1m;

    [Range(0, 9999999.99)]
    public decimal? PackPrice { get; init; }

    public bool IsPreferred { get; init; }
}

public record RemoveItemSupplierCommand(Guid ItemId, Guid SupplierId) : IRequest<List<ItemSupplierDto>?>;

public static class ItemSupplierLoader
{
    public static async Task<List<ItemSupplierDto>?> LoadAsync(WTFDbContext db, Guid itemId, CancellationToken cancellationToken)
    {
        if (!await db.Items.AnyAsync(i => i.Id == itemId, cancellationToken))
        {
            return null;
        }

        var links = await db.ItemSuppliers
            .AsNoTracking()
            .Where(l => l.ItemId == itemId)
            .Select(l => new
            {
                l.Id,
                l.SupplierId,
                SupplierName = l.Supplier.Name,
                SupplierIsActive = l.Supplier.IsActive,
                l.Supplier.LeadTimeDays,
                l.SupplierItemCode,
                l.PackName,
                l.UnitsPerPack,
                l.PackPrice,
                l.IsPreferred
            })
            .ToListAsync(cancellationToken);

        var linkIds = links.Select(l => l.Id).ToList();
        var history = await db.ItemSupplierPriceHistories
            .AsNoTracking()
            .Where(h => linkIds.Contains(h.ItemSupplierId))
            .OrderByDescending(h => h.ChangedAt)
            .Select(h => new
            {
                h.ItemSupplierId,
                Change = new SupplierPriceChangeDto(h.OldPackPrice, h.NewPackPrice, h.Source, h.ChangedAt, h.ChangedByNavigation.Username)
            })
            .ToListAsync(cancellationToken);

        var unitCosts = links.Select(l => PurchasingRules.UnitCost(l.PackPrice, l.UnitsPerPack)).ToList();
        var cheapest = PurchasingRules.CheapestIndex(unitCosts);

        return links
            .Select((l, index) =>
            {
                var changes = history.Where(h => h.ItemSupplierId == l.Id).Select(h => h.Change).Take(20).ToList();
                var last = changes.FirstOrDefault();
                return new ItemSupplierDto(
                    l.Id, l.SupplierId, l.SupplierName, l.SupplierIsActive, l.LeadTimeDays, l.SupplierItemCode, l.PackName,
                    l.UnitsPerPack, l.PackPrice, unitCosts[index], l.IsPreferred, cheapest == index && links.Count > 1,
                    last is null ? null : PurchasingRules.PriceChangePercent(last.OldPackPrice, last.NewPackPrice), changes);
            })
            .OrderByDescending(d => d.IsPreferred)
            .ThenBy(d => d.SupplierName)
            .ToList();
    }
}

public class GetItemSuppliersHandler(WTFDbContext db) : IRequestHandler<GetItemSuppliersQuery, List<ItemSupplierDto>?>
{
    public Task<List<ItemSupplierDto>?> Handle(GetItemSuppliersQuery request, CancellationToken cancellationToken) =>
        ItemSupplierLoader.LoadAsync(db, request.ItemId, cancellationToken);
}

public class SaveItemSupplierHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SaveItemSupplierCommand, List<ItemSupplierDto>?>
{
    public async Task<List<ItemSupplierDto>?> Handle(SaveItemSupplierCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var supplier = await db.Suppliers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.SupplierId, cancellationToken)
            ?? throw new InvalidOperationException("The supplier was not found.");

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var links = await db.ItemSuppliers.Where(l => l.ItemId == item.Id).ToListAsync(cancellationToken);
        var link = links.FirstOrDefault(l => l.SupplierId == supplier.Id);
        if (link is null && !supplier.IsActive)
        {
            throw new InvalidOperationException("This supplier is inactive. Restore it before linking items.");
        }

        var isNew = link is null;
        var oldPrice = link?.PackPrice;
        if (link is null)
        {
            link = new ItemSupplier { ItemId = item.Id, SupplierId = supplier.Id, CreatedAt = now, CreatedBy = userId };
            db.ItemSuppliers.Add(link);
            links.Add(link);
        }
        else
        {
            link.UpdatedAt = now;
            link.UpdatedBy = userId;
        }

        link.SupplierItemCode = ItemValidation.NormalizeOptional(request.SupplierItemCode);
        link.PackName = ItemValidation.NormalizeOptional(request.PackName);
        link.UnitsPerPack = request.UnitsPerPack;
        link.PackPrice = request.PackPrice;

        // An item with suppliers always has a preferred one: the first supplier becomes it, and asking for another
        // one moves the flag.
        var preferred = request.IsPreferred || !links.Any(l => l != link && l.IsPreferred);
        if (preferred)
        {
            foreach (var other in links.Where(l => l != link && l.IsPreferred))
            {
                other.IsPreferred = false;
            }

            // Two saves, so the one-preferred-per-item index never sees two flags set at once.
            await db.SaveChangesAsync(cancellationToken);
        }

        link.IsPreferred = preferred;
        await db.SaveChangesAsync(cancellationToken);

        if (request.PackPrice.HasValue && request.PackPrice != oldPrice)
        {
            db.ItemSupplierPriceHistories.Add(new ItemSupplierPriceHistory
            {
                ItemSupplierId = link.Id,
                OldPackPrice = oldPrice,
                NewPackPrice = request.PackPrice.Value,
                Source = "Manual",
                ChangedAt = now,
                ChangedBy = userId
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.ItemSupplierSaved,
            AuditEntityType.ItemSupplier,
            link.Id.ToString(),
            newValues: new
            {
                ItemName = item.Name,
                SupplierName = supplier.Name,
                link.PackName,
                link.UnitsPerPack,
                link.PackPrice,
                link.IsPreferred
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return await ItemSupplierLoader.LoadAsync(db, item.Id, cancellationToken);
    }
}

public class RemoveItemSupplierHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<RemoveItemSupplierCommand, List<ItemSupplierDto>?>
{
    public async Task<List<ItemSupplierDto>?> Handle(RemoveItemSupplierCommand request, CancellationToken cancellationToken)
    {
        var link = await db.ItemSuppliers
            .Include(l => l.Item)
            .Include(l => l.Supplier)
            .Include(l => l.ItemSupplierPriceHistories)
            .FirstOrDefaultAsync(l => l.ItemId == request.ItemId && l.SupplierId == request.SupplierId, cancellationToken);
        if (link is null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        db.ItemSupplierPriceHistories.RemoveRange(link.ItemSupplierPriceHistories);
        db.ItemSuppliers.Remove(link);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ItemSupplierRemoved,
            AuditEntityType.ItemSupplier,
            link.Id.ToString(),
            oldValues: new { ItemName = link.Item.Name, SupplierName = link.Supplier.Name, link.PackPrice },
            userId: userId,
            cancellationToken: cancellationToken);

        return await ItemSupplierLoader.LoadAsync(db, request.ItemId, cancellationToken);
    }
}
