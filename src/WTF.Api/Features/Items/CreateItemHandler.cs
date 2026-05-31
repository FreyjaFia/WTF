using System.ComponentModel.DataAnnotations;
using MediatR;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

public record CreateItemCommand : IRequest<ItemDto>
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

public class CreateItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CreateItemCommand, ItemDto>
{
    public async Task<ItemDto> Handle(CreateItemCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

        await ItemValidation.ValidateUniqueSkuAndBarcode(db, request.Sku, request.Barcode, null, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var item = new Item
        {
            Name = request.Name.Trim(),
            Sku = ItemValidation.NormalizeOptional(request.Sku),
            Barcode = ItemValidation.NormalizeOptional(request.Barcode),
            UnitName = request.UnitName.Trim(),
            StockUnitName = ItemValidation.NormalizeOptional(request.StockUnitName),
            UnitsPerStockUnit = request.UnitsPerStockUnit,
            CurrentQuantity = request.StartingQuantity,
            CostPrice = request.CostPrice,
            WarningQuantity = request.WarningQuantity,
            CriticalQuantity = request.CriticalQuantity,
            IsActive = request.IsActive,
            CreatedAt = now,
            CreatedBy = userId
        };

        db.Items.Add(item);
        await db.SaveChangesAsync(cancellationToken);

        if (request.StartingQuantity > 0)
        {
            db.StockMovements.Add(new StockMovement
            {
                ItemId = item.Id,
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
            AuditAction.ItemCreated,
            AuditEntityType.Item,
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

        return (await new GetItemByIdHandler(db).Handle(new GetItemByIdQuery(item.Id), cancellationToken))!;
    }
}
