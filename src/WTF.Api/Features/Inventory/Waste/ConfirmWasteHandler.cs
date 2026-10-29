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

namespace WTF.Api.Features.Inventory.Waste;

public record ReviewWasteRequest
{
    [StringLength(500)]
    public string? Note { get; init; }
}

public record ConfirmWasteCommand(Guid Id, string? Note) : IRequest<StockWasteDto?>;

public class ConfirmWasteHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    INotificationService? notifications = null) : IRequestHandler<ConfirmWasteCommand, StockWasteDto?>
{
    public Task<StockWasteDto?> Handle(ConfirmWasteCommand request, CancellationToken cancellationToken) =>
        WasteReview.ReviewAsync(
            db,
            httpContextAccessor,
            auditService,
            notifications,
            request.Id,
            request.Note,
            noteRequired: false,
            StockWasteStatuses.Confirmed,
            AuditAction.StockWasteConfirmed,
            cancellationToken);
}

internal static class WasteReview
{
    public static async Task<StockWasteDto?> ReviewAsync(
        WTFDbContext db,
        IHttpContextAccessor httpContextAccessor,
        IAuditService auditService,
        INotificationService? notifications,
        Guid id,
        string? note,
        bool noteRequired,
        byte newStatus,
        AuditAction action,
        CancellationToken cancellationToken)
    {
        var normalizedNote = ItemValidation.NormalizeOptional(note);
        if (normalizedNote is { Length: > 500 })
        {
            throw new InvalidOperationException("The note can be at most 500 characters.");
        }

        if (noteRequired && normalizedNote is null)
        {
            throw new InvalidOperationException("Say why the entry is disputed.");
        }

        var waste = await db.StockWastes.FirstOrDefaultAsync(w => w.Id == id, cancellationToken);
        if (waste is null)
        {
            return null;
        }

        if (waste.Status != StockWasteStatuses.PendingReview)
        {
            throw new InvalidOperationException("Only an entry waiting for review can be confirmed or disputed.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        if (db.Database.IsRelational())
        {
            // Guarded update so two reviewers answering at once change the entry only once.
            var rows = await db.StockWastes
                .Where(w => w.Id == id && w.Status == StockWasteStatuses.PendingReview)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(w => w.Status, newStatus)
                        .SetProperty(w => w.ReviewedAt, now)
                        .SetProperty(w => w.ReviewedBy, userId)
                        .SetProperty(w => w.ReviewNote, normalizedNote),
                    cancellationToken);
            if (rows != 1)
            {
                throw new InvalidOperationException("Only an entry waiting for review can be confirmed or disputed.");
            }

            db.Entry(waste).State = EntityState.Detached;
        }
        else
        {
            waste.Status = newStatus;
            waste.ReviewedAt = now;
            waste.ReviewedBy = userId;
            waste.ReviewNote = normalizedNote;
            await db.SaveChangesAsync(cancellationToken);
        }

        await WasteReviewNotifications.ResolveAsync(db, notifications, waste.Id, now, cancellationToken);

        await auditService.LogAsync(
            action,
            AuditEntityType.StockWaste,
            waste.Id.ToString(),
            oldValues: new { Status = StockWasteStatuses.Name(StockWasteStatuses.PendingReview) },
            newValues: new { waste.ItemId, waste.Quantity, Status = StockWasteStatuses.Name(newStatus), Note = normalizedNote },
            userId: userId,
            cancellationToken: cancellationToken);

        return await StockWasteMapping.LoadAsync(db, waste.Id, cancellationToken);
    }
}
