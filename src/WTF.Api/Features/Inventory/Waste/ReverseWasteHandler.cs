using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Features.Items;
using WTF.Api.Features.Notifications;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Waste;

public record ReverseWasteRequest
{
    [StringLength(500)]
    public string? Reason { get; init; }
}

public record ReverseWasteCommand(Guid Id, string? Reason) : IRequest<StockWasteDto?>;

public class ReverseWasteHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts,
    INotificationService? notifications = null) : IRequestHandler<ReverseWasteCommand, StockWasteDto?>
{
    public async Task<StockWasteDto?> Handle(ReverseWasteCommand request, CancellationToken cancellationToken)
    {
        var reason = ItemValidation.NormalizeOptional(request.Reason)
            ?? throw new InvalidOperationException("Say why the waste entry is reversed.");
        if (reason.Length > 500)
        {
            throw new InvalidOperationException("The reason can be at most 500 characters.");
        }

        var waste = await db.StockWastes.FirstOrDefaultAsync(w => w.Id == request.Id, cancellationToken);
        if (waste is null)
        {
            return null;
        }

        if (waste.Status == StockWasteStatuses.Reversed)
        {
            throw new InvalidOperationException("This waste entry was already reversed.");
        }

        var item = await db.Items.AsNoTracking().FirstAsync(i => i.Id == waste.ItemId, cancellationToken);
        if (!item.IsActive)
        {
            throw new InvalidOperationException("This item is inactive. Restore it before reversing its waste.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        var previousStatus = waste.Status;

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var relational = db.Database.IsRelational();
        if (relational)
        {
            // Claim the reversal first: a second reverser waits on the row lock, then finds it reversed.
            var claimed = await db.StockWastes
                .Where(w => w.Id == waste.Id && w.Status != StockWasteStatuses.Reversed)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(w => w.Status, StockWasteStatuses.Reversed)
                        .SetProperty(w => w.ReversedAt, now)
                        .SetProperty(w => w.ReversedBy, userId)
                        .SetProperty(w => w.ReversalReason, reason),
                    cancellationToken);
            if (claimed != 1)
            {
                throw new InvalidOperationException("This waste entry was already reversed.");
            }

            db.Entry(waste).State = EntityState.Detached;
        }

        var applied = await StockBalance.ApplyAsync(db, item.Id, waste.Quantity, true, cancellationToken)
            ?? throw new InvalidOperationException("The stock balance could not be updated.");

        var movement = new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            MovementType = StockMovementTypes.WasteReversed,
            QuantityDelta = waste.Quantity,
            QuantityBefore = applied.Before,
            QuantityAfter = applied.After,
            UnitCost = item.CostPrice,
            ReferenceType = StockMovementTypes.StockWasteReference,
            ReferenceId = waste.Id,
            Notes = $"Waste reversed: {reason}",
            CreatedAt = now,
            CreatedBy = userId
        };

        db.StockMovements.Add(movement);
        if (relational)
        {
            await db.SaveChangesAsync(cancellationToken);
            await db.StockWastes
                .Where(w => w.Id == waste.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(w => w.ReversalMovementId, movement.Id), cancellationToken);
        }
        else
        {
            waste.Status = StockWasteStatuses.Reversed;
            waste.ReversedAt = now;
            waste.ReversedBy = userId;
            waste.ReversalReason = reason;
            waste.ReversalMovementId = movement.Id;
            await db.SaveChangesAsync(cancellationToken);
        }

        await WasteReviewNotifications.ResolveAsync(db, notifications, waste.Id, now, cancellationToken);
        await stockAlerts.EvaluateAsync([item.Id], cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.StockWasteReversed,
            AuditEntityType.StockWaste,
            waste.Id.ToString(),
            oldValues: new { Status = StockWasteStatuses.Name(previousStatus) },
            newValues: new
            {
                waste.ItemId,
                item.Name,
                waste.Quantity,
                Reason = reason,
                applied.Before,
                applied.After,
                Status = StockWasteStatuses.Name(StockWasteStatuses.Reversed)
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return await StockWasteMapping.LoadAsync(db, waste.Id, cancellationToken);
    }
}
