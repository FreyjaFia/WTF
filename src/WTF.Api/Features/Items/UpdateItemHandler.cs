using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Items;

public record UpdateItemCommand : IRequest<ItemDto?>
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

public class UpdateItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<UpdateItemCommand, ItemDto?>
{
    public async Task<ItemDto?> Handle(UpdateItemCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.Id, cancellationToken);
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

        await ItemValidation.ValidateUniqueSkuAndBarcode(db, request.Sku, request.Barcode, request.Id, cancellationToken);

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        item.Name = request.Name.Trim();
        item.Sku = ItemValidation.NormalizeOptional(request.Sku);
        item.Barcode = ItemValidation.NormalizeOptional(request.Barcode);
        item.UnitName = request.UnitName.Trim();
        item.StockUnitName = ItemValidation.NormalizeOptional(request.StockUnitName);
        item.UnitsPerStockUnit = request.UnitsPerStockUnit;
        item.CostPrice = request.CostPrice;
        item.WarningQuantity = request.WarningQuantity;
        item.CriticalQuantity = request.CriticalQuantity;
        item.IsActive = request.IsActive;
        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ItemUpdated,
            AuditEntityType.Item,
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

        return await new GetItemByIdHandler(db).Handle(new GetItemByIdQuery(item.Id), cancellationToken);
    }
}
