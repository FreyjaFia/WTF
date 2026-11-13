using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Time;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Services;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record BulkApproveHeldOrdersCommand(HeldOrderFilter Filter, bool Preview) : IRequest<BulkApproveResultDto>;

public class BulkApproveHeldOrdersHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHeldOrderApprover approver,
    IAuditService auditService) : IRequestHandler<BulkApproveHeldOrdersCommand, BulkApproveResultDto>
{
    public async Task<BulkApproveResultDto> Handle(BulkApproveHeldOrdersCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var agedAfterDays = await HeldOrderAging.AgedAfterDaysAsync(db, cancellationToken);
        var filter = request.Filter;
        var filterCodes = filter.ReasonCodes ?? [];

        var candidates = await HeldOrderQueries.Matching(db, filter, timeZone, DateTime.UtcNow, agedAfterDays)
            .AsNoTracking()
            .OrderBy(o => o.CreatedAt)
            .Select(o => new { o.Id, o.OrderNumber, Amount = o.QuotedTotal ?? 0m })
            .Take(HeldOrderQueries.MaxOrders + 1)
            .ToListAsync(cancellationToken);

        var truncated = candidates.Count > HeldOrderQueries.MaxOrders;
        candidates = [.. candidates.Take(HeldOrderQueries.MaxOrders)];

        var reasons = await HeldOrderQueries.LoadReasonsAsync(db, [.. candidates.Select(c => c.Id)], cancellationToken);
        var items = new List<BulkApproveItemDto>();
        var toApprove = new List<(Guid Id, int OrderNumber, decimal Amount)>();

        foreach (var candidate in candidates)
        {
            reasons.TryGetValue(candidate.Id, out var orderReasons);
            var skip = HeldOrderRules.BulkSkipReason(HeldOrderQueries.HoldCodes(orderReasons), [.. filterCodes]);
            if (skip is not null)
            {
                items.Add(new BulkApproveItemDto(
                    candidate.Id, candidate.OrderNumber, candidate.Amount, BulkApproveOutcomes.SkippedSeniorPwd,
                    "Senior/PWD holds are approved one by one."));
                continue;
            }

            toApprove.Add((candidate.Id, candidate.OrderNumber, candidate.Amount));
        }

        // An id the Admin picked that is no longer held (decided by someone else, or not theirs to see) is reported, not hidden.
        if (filter.Ids is { Count: > 0 })
        {
            var found = candidates.Select(c => c.Id).ToHashSet();
            var missing = filter.Ids.Where(id => !found.Contains(id)).Distinct().ToList();
            var known = await db.Orders.AsNoTracking()
                .Where(o => missing.Contains(o.Id))
                .Select(o => new { o.Id, o.OrderNumber, Amount = o.QuotedTotal ?? 0m })
                .ToListAsync(cancellationToken);

            foreach (var id in missing)
            {
                var order = known.FirstOrDefault(k => k.Id == id);
                items.Add(new BulkApproveItemDto(
                    id, order?.OrderNumber, order?.Amount ?? 0m, BulkApproveOutcomes.SkippedNotHeld,
                    "It is not waiting for review any more."));
            }
        }

        if (request.Preview)
        {
            items.AddRange(toApprove.Select(o => new BulkApproveItemDto(o.Id, o.OrderNumber, o.Amount, BulkApproveOutcomes.WouldApprove)));
            return Result(true, items, truncated);
        }

        foreach (var (id, orderNumber, amount) in toApprove)
        {
            items.Add(await ApproveOneAsync(id, orderNumber, amount, userId, cancellationToken));
        }

        var result = Result(false, items, truncated);
        await auditService.LogAsync(
            action: AuditAction.OrderReviewBulkApproved,
            entityType: AuditEntityType.Order,
            entityId: "bulk",
            newValues: new
            {
                Approved = result.Count,
                result.TotalAmount,
                Skipped = result.SkippedCount,
                Failed = result.FailedCount,
                ReasonCodes = filterCodes,
                filter.CashierId,
                filter.FromDate,
                filter.ToDate,
                filter.AgedOnly,
                PickedOrders = filter.Ids?.Count ?? 0,
                ApprovedOrderIds = items.Where(i => i.Outcome == BulkApproveOutcomes.Approved).Select(i => i.Id)
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return result;
    }

    private async Task<BulkApproveItemDto> ApproveOneAsync(Guid id, int orderNumber, decimal amount, Guid userId, CancellationToken cancellationToken)
    {
        try
        {
            var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
            if (order is null)
            {
                return new BulkApproveItemDto(id, orderNumber, amount, BulkApproveOutcomes.SkippedNotHeld, "It is not waiting for review any more.");
            }

            await approver.ApproveAsync(order, userId, cancellationToken);
            return new BulkApproveItemDto(id, orderNumber, amount, BulkApproveOutcomes.Approved);
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("Only orders waiting for review", StringComparison.Ordinal))
        {
            db.ChangeTracker.Clear();
            return new BulkApproveItemDto(id, orderNumber, amount, BulkApproveOutcomes.SkippedNotHeld, "Someone else decided this order first.");
        }
        catch (Exception ex) when (ex is InvalidOperationException or DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return new BulkApproveItemDto(id, orderNumber, amount, BulkApproveOutcomes.Failed, ex.Message);
        }
    }

    private static BulkApproveResultDto Result(bool preview, List<BulkApproveItemDto> items, bool truncated)
    {
        var counted = items.Where(i => i.Outcome is BulkApproveOutcomes.Approved or BulkApproveOutcomes.WouldApprove).ToList();
        var now = DateTime.UtcNow;
        var totals = HeldOrderRules.Summarize(counted.Select(i => new HeldOrderFigure(now, i.Amount)), now);
        return new BulkApproveResultDto(
            preview,
            totals.Count,
            totals.Amount,
            items.Count(i => i.Outcome is BulkApproveOutcomes.SkippedSeniorPwd or BulkApproveOutcomes.SkippedNotHeld),
            items.Count(i => i.Outcome == BulkApproveOutcomes.Failed),
            truncated,
            items);
    }
}
