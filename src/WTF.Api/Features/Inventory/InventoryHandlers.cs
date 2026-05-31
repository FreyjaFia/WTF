using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record GetInventoryItemsQuery(
    string? SearchTerm = null,
    bool? IsActive = null,
    bool IncludeInactive = false) : IRequest<List<InventoryItemDto>>;

public record GetInventoryItemByIdQuery(Guid Id) : IRequest<InventoryItemDto?>;

public record DeleteInventoryItemCommand(Guid Id) : IRequest<bool>;

public record CreateInventoryItemCommand : IRequest<InventoryItemDto>
{
    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    [StringLength(50)]
    public string? Sku { get; init; }

    [StringLength(100)]
    public string? Barcode { get; init; }

    [Required]
    [StringLength(30)]
    public string UnitName { get; init; } = "piece";

    [StringLength(30)]
    public string? StockUnitName { get; init; }

    [Range(0.001, 999999.999)]
    public decimal? UnitsPerStockUnit { get; init; }

    [Range(0, 999999.999)]
    public decimal StartingQuantity { get; init; }

    [Range(0, 999999.99)]
    public decimal? CostPrice { get; init; }

    [Range(0, 999999.999)]
    public decimal? WarningQuantity { get; init; }

    [Range(0, 999999.999)]
    public decimal? CriticalQuantity { get; init; }

    public bool IsActive { get; init; } = true;
}

public record UpdateInventoryItemCommand : IRequest<InventoryItemDto?>
{
    public Guid Id { get; init; }

    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    [StringLength(50)]
    public string? Sku { get; init; }

    [StringLength(100)]
    public string? Barcode { get; init; }

    [Required]
    [StringLength(30)]
    public string UnitName { get; init; } = "piece";

    [StringLength(30)]
    public string? StockUnitName { get; init; }

    [Range(0.001, 999999.999)]
    public decimal? UnitsPerStockUnit { get; init; }

    [Range(0, 999999.99)]
    public decimal? CostPrice { get; init; }

    [Range(0, 999999.999)]
    public decimal? WarningQuantity { get; init; }

    [Range(0, 999999.999)]
    public decimal? CriticalQuantity { get; init; }

    public bool IsActive { get; init; } = true;
}

public record AddInventoryStockCommand : IRequest<InventoryItemDto?>
{
    public Guid InventoryItemId { get; init; }

    [Range(0.001, 999999.999)]
    public decimal Quantity { get; init; }

    [Range(0, 999999.99)]
    public decimal? UnitCost { get; init; }

    [StringLength(500)]
    public string? Notes { get; init; }
}

public record LinkProductInventoryCommand : IRequest<ProductInventoryLinkDto>
{
    public Guid ProductId { get; init; }

    public Guid InventoryItemId { get; init; }

    [Range(0.001, 999999.999)]
    public decimal QuantityPerSale { get; init; } = 1;
}

public class GetInventoryItemsHandler(WTFDbContext db) : IRequestHandler<GetInventoryItemsQuery, List<InventoryItemDto>>
{
    public async Task<List<InventoryItemDto>> Handle(GetInventoryItemsQuery request, CancellationToken cancellationToken)
    {
        var query = db.InventoryItems.AsNoTracking().AsQueryable();

        if (!request.IncludeInactive)
        {
            query = query.Where(i => i.IsActive);
        }

        if (request.IsActive.HasValue)
        {
            query = query.Where(i => i.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var search = request.SearchTerm.Trim();
            query = query.Where(i =>
                i.Name.Contains(search)
                || (i.Sku != null && i.Sku.Contains(search))
                || (i.Barcode != null && i.Barcode.Contains(search)));
        }

        var items = await query
            .Include(i => i.ProductInventoryLinks)
                .ThenInclude(l => l.Product)
            .OrderBy(i => i.Name)
            .ToListAsync(cancellationToken);

        return items.Select(InventoryMapping.ToDto).ToList();
    }
}

public class GetInventoryItemByIdHandler(WTFDbContext db) : IRequestHandler<GetInventoryItemByIdQuery, InventoryItemDto?>
{
    public async Task<InventoryItemDto?> Handle(GetInventoryItemByIdQuery request, CancellationToken cancellationToken)
    {
        var item = await db.InventoryItems
            .AsNoTracking()
            .Include(i => i.ProductInventoryLinks)
                .ThenInclude(l => l.Product)
            .Include(i => i.StockMovements.OrderByDescending(m => m.CreatedAt).Take(25))
                .ThenInclude(m => m.CreatedByNavigation)
            .FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);

        return item is null ? null : InventoryMapping.ToDto(item);
    }
}

public class CreateInventoryItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CreateInventoryItemCommand, InventoryItemDto>
{
    public async Task<InventoryItemDto> Handle(CreateInventoryItemCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

        await InventoryValidation.ValidateUniqueSkuAndBarcode(db, request.Sku, request.Barcode, null, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var item = new InventoryItem
        {
            Name = request.Name.Trim(),
            Sku = InventoryValidation.NormalizeOptional(request.Sku),
            Barcode = InventoryValidation.NormalizeOptional(request.Barcode),
            UnitName = request.UnitName.Trim(),
            StockUnitName = InventoryValidation.NormalizeOptional(request.StockUnitName),
            UnitsPerStockUnit = request.UnitsPerStockUnit,
            CurrentQuantity = request.StartingQuantity,
            CostPrice = request.CostPrice,
            WarningQuantity = request.WarningQuantity,
            CriticalQuantity = request.CriticalQuantity,
            IsActive = request.IsActive,
            CreatedAt = now,
            CreatedBy = userId
        };

        db.InventoryItems.Add(item);
        await db.SaveChangesAsync(cancellationToken);

        if (request.StartingQuantity > 0)
        {
            db.StockMovements.Add(new StockMovement
            {
                InventoryItemId = item.Id,
                MovementType = "AddStock",
                QuantityDelta = request.StartingQuantity,
                QuantityBefore = 0,
                QuantityAfter = request.StartingQuantity,
                UnitCost = request.CostPrice,
                Notes = "Initial stock",
                CreatedAt = now,
                CreatedBy = userId
            });

            await db.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.InventoryItemCreated,
            AuditEntityType.InventoryItem,
            item.Id.ToString(),
            newValues: new
            {
                item.Name,
                item.Sku,
                item.Barcode,
                item.UnitName,
                item.StockUnitName,
                item.UnitsPerStockUnit,
                item.CurrentQuantity,
                item.CostPrice,
                item.WarningQuantity,
                item.CriticalQuantity,
                item.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await new GetInventoryItemByIdHandler(db).Handle(new GetInventoryItemByIdQuery(item.Id), cancellationToken))!;
    }
}

public class UpdateInventoryItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<UpdateInventoryItemCommand, InventoryItemDto?>
{
    public async Task<InventoryItemDto?> Handle(UpdateInventoryItemCommand request, CancellationToken cancellationToken)
    {
        var item = await db.InventoryItems.FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var oldValues = new
        {
            item.Name,
            item.Sku,
            item.Barcode,
            item.UnitName,
            item.StockUnitName,
            item.UnitsPerStockUnit,
            item.CostPrice,
            item.WarningQuantity,
            item.CriticalQuantity,
            item.IsActive
        };

        await InventoryValidation.ValidateUniqueSkuAndBarcode(db, request.Sku, request.Barcode, request.Id, cancellationToken);

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        item.Name = request.Name.Trim();
        item.Sku = InventoryValidation.NormalizeOptional(request.Sku);
        item.Barcode = InventoryValidation.NormalizeOptional(request.Barcode);
        item.UnitName = request.UnitName.Trim();
        item.StockUnitName = InventoryValidation.NormalizeOptional(request.StockUnitName);
        item.UnitsPerStockUnit = request.UnitsPerStockUnit;
        item.CostPrice = request.CostPrice;
        item.WarningQuantity = request.WarningQuantity;
        item.CriticalQuantity = request.CriticalQuantity;
        item.IsActive = request.IsActive;
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.InventoryItemUpdated,
            AuditEntityType.InventoryItem,
            item.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                item.Name,
                item.Sku,
                item.Barcode,
                item.UnitName,
                item.StockUnitName,
                item.UnitsPerStockUnit,
                item.CostPrice,
                item.WarningQuantity,
                item.CriticalQuantity,
                item.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return await new GetInventoryItemByIdHandler(db).Handle(new GetInventoryItemByIdQuery(item.Id), cancellationToken);
    }
}

public class AddInventoryStockHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<AddInventoryStockCommand, InventoryItemDto?>
{
    public async Task<InventoryItemDto?> Handle(AddInventoryStockCommand request, CancellationToken cancellationToken)
    {
        var item = await db.InventoryItems.FirstOrDefaultAsync(i => i.Id == request.InventoryItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var before = item.CurrentQuantity;
        var after = before + request.Quantity;

        item.CurrentQuantity = after;
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;
        if (request.UnitCost.HasValue)
        {
            item.CostPrice = request.UnitCost;
        }

        var movement = new StockMovement
        {
            InventoryItemId = item.Id,
            MovementType = "AddStock",
            QuantityDelta = request.Quantity,
            QuantityBefore = before,
            QuantityAfter = after,
            UnitCost = request.UnitCost,
            Notes = InventoryValidation.NormalizeOptional(request.Notes),
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.StockMovements.Add(movement);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.InventoryStockAdded,
            AuditEntityType.StockMovement,
            movement.Id.ToString(),
            newValues: new
            {
                item.Id,
                item.Name,
                request.Quantity,
                before,
                after,
                request.UnitCost,
                request.Notes
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return await new GetInventoryItemByIdHandler(db).Handle(new GetInventoryItemByIdQuery(item.Id), cancellationToken);
    }
}

public class DeleteInventoryItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<DeleteInventoryItemCommand, bool>
{
    public async Task<bool> Handle(DeleteInventoryItemCommand request, CancellationToken cancellationToken)
    {
        var item = await db.InventoryItems.FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
        if (item is null)
        {
            return false;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            item.Name,
            item.Sku,
            item.Barcode,
            item.IsActive
        };

        item.IsActive = false;
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.InventoryItemDeleted,
            AuditEntityType.InventoryItem,
            item.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                item.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}

public class LinkProductInventoryHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<LinkProductInventoryCommand, ProductInventoryLinkDto>
{
    public async Task<ProductInventoryLinkDto> Handle(LinkProductInventoryCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken)
            ?? throw new InvalidOperationException("Product not found.");
        var inventoryItem = await db.InventoryItems.FirstOrDefaultAsync(i => i.Id == request.InventoryItemId, cancellationToken)
            ?? throw new InvalidOperationException("Inventory item not found.");

        var link = await db.ProductInventoryLinks
            .FirstOrDefaultAsync(
                l => l.ProductId == request.ProductId && l.InventoryItemId == request.InventoryItemId,
                cancellationToken);

        if (link is null)
        {
            link = new ProductInventoryLink
            {
                ProductId = request.ProductId,
                InventoryItemId = request.InventoryItemId,
                QuantityPerSale = request.QuantityPerSale,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = userId
            };
            db.ProductInventoryLinks.Add(link);
        }
        else
        {
            link.QuantityPerSale = request.QuantityPerSale;
            link.IsActive = true;
            link.UpdatedAt = DateTime.UtcNow;
            link.UpdatedBy = userId;
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductInventoryLinked,
            AuditEntityType.ProductInventoryLink,
            link.Id.ToString(),
            newValues: new
            {
                product.Id,
                ProductName = product.Name,
                InventoryItemId = inventoryItem.Id,
                InventoryItemName = inventoryItem.Name,
                link.QuantityPerSale,
                link.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return new ProductInventoryLinkDto(
            link.Id,
            product.Id,
            product.Name,
            product.Code,
            inventoryItem.Id,
            link.QuantityPerSale,
            link.IsActive);
    }
}

internal static class InventoryMapping
{
    public static InventoryItemDto ToDto(InventoryItem item)
    {
        return new InventoryItemDto(
            item.Id,
            item.Name,
            item.Sku,
            item.Barcode,
            item.UnitName,
            item.StockUnitName,
            item.UnitsPerStockUnit,
            item.CurrentQuantity,
            item.CostPrice,
            item.WarningQuantity,
            item.CriticalQuantity,
            item.IsActive,
            item.CreatedAt,
            item.CreatedBy,
            item.UpdatedAt,
            item.UpdatedBy,
            item.ProductInventoryLinks
                .OrderBy(l => l.Product.Name)
                .Select(l => new ProductInventoryLinkDto(
                    l.Id,
                    l.ProductId,
                    l.Product.Name,
                    l.Product.Code,
                    l.InventoryItemId,
                    l.QuantityPerSale,
                    l.IsActive))
                .ToList(),
            item.StockMovements
                .OrderByDescending(m => m.CreatedAt)
                .Select(m => new StockMovementDto(
                    m.Id,
                    m.InventoryItemId,
                    m.MovementType,
                    m.QuantityDelta,
                    m.QuantityBefore,
                    m.QuantityAfter,
                    m.UnitCost,
                    m.ReferenceType,
                    m.ReferenceId,
                    m.Notes,
                    m.CreatedAt,
                    m.CreatedBy,
                    $"{m.CreatedByNavigation.FirstName} {m.CreatedByNavigation.LastName}".Trim()))
                .ToList());
    }
}

internal static class InventoryValidation
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
            var skuExists = await db.InventoryItems.AnyAsync(
                i => i.Sku == normalizedSku && (!currentId.HasValue || i.Id != currentId.Value),
                cancellationToken);
            if (skuExists)
            {
                throw new InvalidOperationException("Inventory SKU already exists.");
            }
        }

        var normalizedBarcode = NormalizeOptional(barcode);
        if (normalizedBarcode is not null)
        {
            var barcodeExists = await db.InventoryItems.AnyAsync(
                i => i.Barcode == normalizedBarcode && (!currentId.HasValue || i.Id != currentId.Value),
                cancellationToken);
            if (barcodeExists)
            {
                throw new InvalidOperationException("Inventory barcode already exists.");
            }
        }
    }

    public static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
