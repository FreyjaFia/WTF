using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Api.Features.Items;
using WTF.Api.Features.Notifications;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Waste;

public record RecordWasteRequest
{
    [Range(0.001, 999999.999)]
    public decimal Quantity { get; init; }

    public int WasteReasonId { get; init; }

    [StringLength(500)]
    public string? Notes { get; init; }

    public byte? Source { get; init; }

    public Guid? ClientRequestId { get; init; }
}

public record RecordWasteCommand(
    Guid ItemId,
    decimal Quantity,
    int WasteReasonId,
    string? Notes,
    byte? Source,
    Guid? ClientRequestId = null) : IRequest<StockWasteDto?>;

public class RecordWasteHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts,
    INotificationService notifications) : IRequestHandler<RecordWasteCommand, StockWasteDto?>
{
    private const decimal MaxQuantity = 999999.999m;

    private static readonly string[] ReviewerRoles = [AppRoles.SuperAdmin, AppRoles.Admin];

    public async Task<StockWasteDto?> Handle(RecordWasteCommand request, CancellationToken cancellationToken)
    {
        if (request.Quantity <= 0m || request.Quantity > MaxQuantity)
        {
            throw new InvalidOperationException("Enter a quantity above zero and at most 999,999.999.");
        }

        var quantity = StockRules.Round(request.Quantity);
        if (quantity <= 0m)
        {
            throw new InvalidOperationException("Enter a quantity above zero and at most 999,999.999.");
        }

        var source = request.Source ?? StockWasteStatuses.SourceItemDetails;
        if (source is not (StockWasteStatuses.SourceItemDetails or StockWasteStatuses.SourcePos))
        {
            throw new InvalidOperationException("Unknown waste source.");
        }

        var notes = ItemValidation.NormalizeOptional(request.Notes);
        if (notes is { Length: > 500 })
        {
            throw new InvalidOperationException("The note can be at most 500 characters.");
        }

        var clientRequestId = request.ClientRequestId is { } requestId && requestId != Guid.Empty ? requestId : (Guid?)null;
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        if (clientRequestId is not null)
        {
            var existing = await FindExistingAsync(clientRequestId.Value, request.ItemId, userId, cancellationToken);
            if (existing is not null)
            {
                return existing;
            }
        }

        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        if (!item.IsActive)
        {
            throw new InvalidOperationException("This item is inactive. Restore it before recording waste.");
        }

        var reason = await db.WasteReasons.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == request.WasteReasonId, cancellationToken);
        if (reason is null || !reason.IsActive)
        {
            throw new InvalidOperationException("Choose one of the listed waste reasons.");
        }

        if (reason.RequiresNote && notes is null)
        {
            throw new InvalidOperationException($"A note is required when the reason is {reason.Name}.");
        }

        var needsReview = WasteRules.NeedsReview(quantity, item.WasteApprovalLimit);
        var wasteId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var result = await StockBalance.ApplyAsync(db, item.Id, -quantity, item.AllowNegativeStock, cancellationToken);
        if (result is null)
        {
            var balance = await db.Items.AsNoTracking()
                .Where(i => i.Id == item.Id)
                .Select(i => i.CurrentQuantity)
                .FirstAsync(cancellationToken);
            var shortfall = WasteRules.Shortfall(balance, quantity);
            throw new InvalidOperationException(
                $"Not enough {item.Name}: short by {StockWasteMapping.FormatQuantity(shortfall, item.UnitName)}. This item cannot go below zero, so the waste was not recorded.");
        }

        var applied = result.Value;

        var movement = new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            MovementType = StockMovementTypes.Waste,
            QuantityDelta = -quantity,
            QuantityBefore = applied.Before,
            QuantityAfter = applied.After,
            UnitCost = CostRules.MovementCost(item.AverageCost, item.CostPrice),
            ReferenceType = StockMovementTypes.StockWasteReference,
            ReferenceId = wasteId,
            Notes = notes is null ? reason.Name : $"{reason.Name}: {notes}",
            CreatedAt = now,
            CreatedBy = userId
        };

        var waste = new StockWaste
        {
            Id = wasteId,
            ItemId = item.Id,
            StockMovementId = movement.Id,
            Quantity = quantity,
            WasteReasonId = reason.Id,
            ReasonName = reason.Name,
            Notes = notes,
            Status = needsReview ? StockWasteStatuses.PendingReview : StockWasteStatuses.Recorded,
            RequiresReview = needsReview,
            Source = source,
            CreatedAt = now,
            CreatedBy = userId,
            ClientRequestId = clientRequestId
        };

        db.StockMovements.Add(movement);
        db.StockWastes.Add(waste);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException) when (clientRequestId is not null && transaction is not null)
        {
            // A concurrent retry with the same request id won the unique index: undo this attempt and return that entry.
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            var existing = await FindExistingAsync(clientRequestId.Value, request.ItemId, userId, cancellationToken);
            if (existing is null)
            {
                throw;
            }

            return existing;
        }
        await stockAlerts.EvaluateAsync([item.Id], cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.StockWasted,
            AuditEntityType.StockWaste,
            waste.Id.ToString(),
            newValues: new
            {
                ItemId = item.Id,
                item.Name,
                Quantity = quantity,
                Reason = reason.Name,
                Notes = notes,
                applied.Before,
                applied.After,
                Status = StockWasteStatuses.Name(waste.Status),
                Source = source
            },
            userId: userId,
            cancellationToken: cancellationToken);

        if (needsReview)
        {
            await NotifyReviewersAsync(item, waste, cancellationToken);
        }

        return await StockWasteMapping.LoadAsync(db, waste.Id, cancellationToken);
    }

    private async Task<StockWasteDto?> FindExistingAsync(
        Guid clientRequestId,
        Guid itemId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var existing = await db.StockWastes.AsNoTracking()
            .Where(w => w.ClientRequestId == clientRequestId)
            .Select(w => new { w.Id, w.ItemId, w.CreatedBy })
            .FirstOrDefaultAsync(cancellationToken);
        if (existing is null)
        {
            return null;
        }

        if (existing.ItemId != itemId || existing.CreatedBy != userId)
        {
            throw new InvalidOperationException("This request id was already used for another waste entry.");
        }

        return await StockWasteMapping.LoadAsync(db, existing.Id, cancellationToken);
    }

    private async Task NotifyReviewersAsync(Item item, StockWaste waste, CancellationToken cancellationToken)
    {
        var recipients = await db.Users.AsNoTracking()
            .Where(u => u.IsActive && ReviewerRoles.Contains(u.Role.Name))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);
        if (recipients.Count == 0)
        {
            return;
        }

        var quantityText = StockWasteMapping.FormatQuantity(waste.Quantity, item.UnitName);
        var limitText = StockWasteMapping.FormatQuantity(item.WasteApprovalLimit ?? 0m, item.UnitName);
        var message = new NotificationMessage(
            NotificationKinds.WasteReview,
            NotificationSeverity.Warning,
            $"Waste to review: {item.Name}",
            $"{quantityText} recorded as {waste.ReasonName}, above the {limitText} limit.",
            "/inventory/waste?status=PendingReview",
            waste.Id);

        await notifications.NotifyAsync(recipients, message, cancellationToken);
    }
}
