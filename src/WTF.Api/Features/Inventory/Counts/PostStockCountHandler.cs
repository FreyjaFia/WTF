using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Counts;

public record PostStockCountCommand(Guid CountId) : IRequest<StockCountDto?>;

public record CancelStockCountCommand(Guid CountId) : IRequest<StockCountDto?>;

public class PostStockCountHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<PostStockCountCommand, StockCountDto?>
{
    public async Task<StockCountDto?> Handle(PostStockCountCommand request, CancellationToken cancellationToken)
    {
        var count = await db.StockCounts
            .Include(c => c.StockCountLines).ThenInclude(l => l.Item)
            .FirstOrDefaultAsync(c => c.Id == request.CountId, cancellationToken);
        if (count is null)
        {
            return null;
        }

        if (count.Status != StockCountStatuses.Open)
        {
            throw new InvalidOperationException("This count is already closed.");
        }

        var counted = count.StockCountLines.Where(l => l.CountedQuantity.HasValue && l.ExpectedQuantity.HasValue).ToList();
        if (counted.Count == 0)
        {
            throw new InvalidOperationException("Count at least one item before posting.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        // Claim the count first: of two people posting at once, only one changes the status and applies the balances.
        if (db.Database.IsRelational())
        {
            var claimed = await db.StockCounts
                .Where(c => c.Id == count.Id && c.Status == StockCountStatuses.Open)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, StockCountStatuses.Posted), cancellationToken);
            if (claimed == 0)
            {
                throw new InvalidOperationException("This count is already closed.");
            }
        }

        var changed = new List<Guid>();
        foreach (var line in counted)
        {
            var item = line.Item;
            if (!item.IsActive)
            {
                continue;
            }

            var delta = StockRules.AdjustmentDelta(line.ExpectedQuantity!.Value, line.CountedQuantity!.Value);
            if (delta == 0m)
            {
                continue;
            }

            var applied = await StockBalance.ApplyAsync(db, item.Id, delta, true, cancellationToken)
                ?? throw new InvalidOperationException($"{item.Name} could not be updated.");

            var movement = new StockMovement
            {
                ItemId = item.Id,
                MovementType = StockMovementTypes.Count,
                QuantityDelta = delta,
                QuantityBefore = applied.Before,
                QuantityAfter = applied.After,
                UnitCost = CostRules.MovementCost(item.AverageCost, item.CostPrice),
                ReferenceType = StockMovementTypes.StockCountReference,
                ReferenceId = count.Id,
                Notes = $"Count: {count.Name}",
                CreatedAt = now,
                CreatedBy = userId
            };
            db.StockMovements.Add(movement);
            line.MovementId = movement.Id;
            changed.Add(item.Id);
        }

        count.Status = StockCountStatuses.Posted;
        count.PostedAt = now;
        count.PostedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        if (changed.Count > 0)
        {
            await stockAlerts.EvaluateAsync(changed, cancellationToken);
        }

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.StockCountPosted,
            AuditEntityType.StockCount,
            count.Id.ToString(),
            newValues: new { count.Name, Counted = counted.Count, Adjusted = changed.Count },
            userId: userId,
            cancellationToken: cancellationToken);

        return await StockCountMapping.LoadAsync(db, count.Id, cancellationToken);
    }
}

public class CancelStockCountHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CancelStockCountCommand, StockCountDto?>
{
    public async Task<StockCountDto?> Handle(CancelStockCountCommand request, CancellationToken cancellationToken)
    {
        var count = await db.StockCounts.FirstOrDefaultAsync(c => c.Id == request.CountId, cancellationToken);
        if (count is null)
        {
            return null;
        }

        if (count.Status != StockCountStatuses.Open)
        {
            throw new InvalidOperationException("This count is already closed.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        count.Status = StockCountStatuses.Cancelled;
        count.CancelledAt = DateTime.UtcNow;
        count.CancelledBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.StockCountCancelled,
            AuditEntityType.StockCount,
            count.Id.ToString(),
            newValues: new { count.Name },
            userId: userId,
            cancellationToken: cancellationToken);

        return await StockCountMapping.LoadAsync(db, count.Id, cancellationToken);
    }
}
