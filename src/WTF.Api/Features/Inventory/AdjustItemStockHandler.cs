using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public static class StockAdjustmentReasons
{
    public const string Other = "Other";

    public static readonly IReadOnlyList<string> All = ["Count correction", "Damaged or spoiled", "Lost", Other];
}

public record AdjustItemStockCommand : IRequest<ItemDto?>
{
    public Guid ItemId { get; init; }

    [Range(0, 999999.999)]
    public decimal? CountedQuantity { get; init; }

    [Range(0, 999999.999)]
    public decimal? ExpectedQuantity { get; init; }

    [Range(-999999.999, 999999.999)]
    public decimal? QuantityChange { get; init; }

    [Required]
    [StringLength(40)]
    public string Reason { get; init; } = string.Empty;

    [StringLength(500)]
    public string? Notes { get; init; }
}

public class AdjustItemStockHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<AdjustItemStockCommand, ItemDto?>
{
    public async Task<ItemDto?> Handle(AdjustItemStockCommand request, CancellationToken cancellationToken)
    {
        var reason = request.Reason.Trim();
        var notes = ItemValidation.NormalizeOptional(request.Notes);
        if (!StockAdjustmentReasons.All.Contains(reason))
        {
            throw new InvalidOperationException("Choose one of the listed reasons.");
        }

        if (reason == StockAdjustmentReasons.Other && notes is null)
        {
            throw new InvalidOperationException("A note is required when the reason is Other.");
        }

        if (request.CountedQuantity.HasValue == request.QuantityChange.HasValue)
        {
            throw new InvalidOperationException("Enter either the counted quantity or the change, not both.");
        }

        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        if (!item.IsActive)
        {
            throw new InvalidOperationException("This item is inactive. Restore it before adjusting its stock.");
        }

        // The difference is applied on top of the balance at the moment of saving, so sales completed while the form was open stay.
        var delta = request.QuantityChange
            ?? StockRules.AdjustmentDelta(request.ExpectedQuantity ?? item.CurrentQuantity, request.CountedQuantity!.Value);
        if (delta == 0m)
        {
            throw new InvalidOperationException("The count matches the balance, so there is nothing to adjust.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var applied = await StockBalance.ApplyAsync(db, item.Id, delta, false, cancellationToken)
            ?? throw new InvalidOperationException("This item does not allow a negative balance, so the adjustment would take it below zero.");

        var movement = new StockMovement
        {
            ItemId = item.Id,
            MovementType = StockMovementTypes.Adjustment,
            QuantityDelta = delta,
            QuantityBefore = applied.Before,
            QuantityAfter = applied.After,
            UnitCost = item.CostPrice,
            Notes = notes is null ? reason : $"{reason}: {notes}",
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
            AuditAction.ItemStockAdjusted,
            AuditEntityType.StockMovement,
            movement.Id.ToString(),
            newValues: new { item.Id, item.Name, delta, applied.Before, applied.After, reason, notes },
            userId: userId,
            cancellationToken: cancellationToken);

        return await new GetItemByIdHandler(db).Handle(new GetItemByIdQuery(item.Id), cancellationToken);
    }
}
