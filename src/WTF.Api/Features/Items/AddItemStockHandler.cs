using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

public record AddItemStockCommand : IRequest<ItemDto?>
{
    public Guid ItemId { get; init; }

    [Range(0.001, 999999.999)]
    public decimal Quantity { get; init; }

    [Range(0, 999999.99)]
    public decimal? UnitCost { get; init; }

    [StringLength(500)]
    public string? Notes { get; init; }
}

public class AddItemStockHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<AddItemStockCommand, ItemDto?>
{
    public async Task<ItemDto?> Handle(AddItemStockCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        item.UpdatedAt = DateTime.UtcNow;
        item.UpdatedBy = userId;
        if (request.UnitCost.HasValue)
        {
            if (item.CostPrice != request.UnitCost)
            {
                db.ItemPriceHistories.Add(new ItemPriceHistory
                {
                    ItemId = item.Id,
                    OldPrice = item.CostPrice,
                    NewPrice = request.UnitCost.Value,
                    UpdatedAt = DateTime.UtcNow,
                    UpdatedBy = userId
                });
            }

            item.CostPrice = request.UnitCost;
        }

        // The balance changes in one statement, so a sale completed at the same moment is never overwritten.
        var applied = await StockBalance.ApplyAsync(db, item.Id, request.Quantity, true, cancellationToken)
            ?? throw new InvalidOperationException("The item was not found.");
        var before = applied.Before;
        var after = applied.After;

        var movement = new StockMovement
        {
            ItemId = item.Id,
            MovementType = StockMovementTypes.AddStock,
            QuantityDelta = request.Quantity,
            QuantityBefore = before,
            QuantityAfter = after,
            UnitCost = request.UnitCost,
            Notes = ItemValidation.NormalizeOptional(request.Notes),
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.StockMovements.Add(movement);
        await db.SaveChangesAsync(cancellationToken);
        await stockAlerts.EvaluateAsync([item.Id], cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.ItemStockAdded,
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

        return await new GetItemByIdHandler(db).Handle(new GetItemByIdQuery(item.Id), cancellationToken);
    }
}
