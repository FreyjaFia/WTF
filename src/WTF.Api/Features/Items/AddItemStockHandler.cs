using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
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
    IAuditService auditService) : IRequestHandler<AddItemStockCommand, ItemDto?>
{
    public async Task<ItemDto?> Handle(AddItemStockCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
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
            ItemId = item.Id,
            MovementType = "AddStock",
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
