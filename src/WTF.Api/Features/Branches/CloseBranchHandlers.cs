using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Branches.DTOs;
using WTF.Api.Features.Inventory.Purchasing;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Branches;

public record GetBranchCloseCheckQuery(Guid Id) : IRequest<BranchCloseCheckDto?>;

public record CloseBranchRequest(Guid? MoveStaffToBranchId);

public record CloseBranchCommand(Guid Id, Guid? MoveStaffToBranchId) : IRequest<BranchDto?>;

public record ReopenBranchCommand(Guid Id) : IRequest<BranchDto?>;

public record MakeMainBranchCommand(Guid Id) : IRequest<BranchDto?>;

public class GetBranchCloseCheckHandler(WTFDbContext db, ICurrentBranch currentBranch) : IRequestHandler<GetBranchCloseCheckQuery, BranchCloseCheckDto?>
{
    public async Task<BranchCloseCheckDto?> Handle(GetBranchCloseCheckQuery request, CancellationToken cancellationToken)
    {
        return await BranchClosing.CheckAsync(db, currentBranch, request.Id, cancellationToken);
    }
}

public class CloseBranchHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    ICurrentBranch currentBranch,
    BranchScopeCache cache) : IRequestHandler<CloseBranchCommand, BranchDto?>
{
    public async Task<BranchDto?> Handle(CloseBranchCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var check = await BranchClosing.CheckAsync(db, currentBranch, request.Id, cancellationToken);
        if (check is null)
        {
            return null;
        }

        if (check.Blockers.Count > 0)
        {
            throw new InvalidOperationException(check.Blockers[0]);
        }

        Branch? target = null;
        if (check.StaffWithNoOtherBranch.Count > 0)
        {
            if (request.MoveStaffToBranchId is not { } moveTo || moveTo == request.Id)
            {
                throw new InvalidOperationException("Choose the branch where the people who work only here will go.");
            }

            target = await BranchRules.AllOfShop(db).FirstOrDefaultAsync(b => b.Id == moveTo && b.IsActive, cancellationToken)
                ?? throw new InvalidOperationException("The branch chosen for the staff is not open.");
        }

        var branch = await BranchRules.AllOfShop(db).FirstAsync(b => b.Id == request.Id, cancellationToken);
        var assignments = await db.UserBranches.Where(u => u.BranchId == branch.Id).ToListAsync(cancellationToken);
        var assignedIds = assignments.Select(a => a.UserId).ToList();
        var users = await db.Users.Where(u => assignedIds.Contains(u.Id)).ToListAsync(cancellationToken);

        foreach (var assignment in assignments)
        {
            var user = users.FirstOrDefault(u => u.Id == assignment.UserId);
            db.UserBranches.Remove(assignment);

            if (user is null)
            {
                continue;
            }

            var needsTarget = check.StaffWithNoOtherBranch.Any(s => s.UserId == user.Id);
            if (needsTarget && target is not null)
            {
                db.UserBranches.Add(new UserBranch { UserId = user.Id, BranchId = target.Id, CreatedAt = DateTime.UtcNow });
            }

            if (user.DefaultBranchId == branch.Id)
            {
                user.DefaultBranchId = needsTarget && target is not null ? target.Id : null;
            }
        }

        branch.IsActive = false;
        branch.UpdatedAt = DateTime.UtcNow;
        branch.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);
        cache.Forget();

        await auditService.LogAsync(
            AuditAction.BranchClosed,
            AuditEntityType.Branch,
            branch.Id.ToString(),
            newValues: new { branch.Name, branch.Code, StaffMovedTo = target?.Code, StaffUnassigned = assignedIds.Count },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await BranchQueries.ListAsync(db, currentBranch, null, null, branch.Id, cancellationToken)).First();
    }
}

public class ReopenBranchHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    ICurrentTenant currentTenant,
    ICurrentBranch currentBranch,
    BranchScopeCache cache) : IRequestHandler<ReopenBranchCommand, BranchDto?>
{
    public async Task<BranchDto?> Handle(ReopenBranchCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var branch = await BranchRules.AllOfShop(db).FirstOrDefaultAsync(b => b.Id == request.Id, cancellationToken);
        if (branch is null || (BranchRules.IsLimited(currentBranch) && !currentBranch.AllowedBranchIds.Contains(branch.Id)))
        {
            return null;
        }

        if (branch.IsActive)
        {
            throw new InvalidOperationException("This branch is already open.");
        }

        await BranchRules.EnsureCanAddBranchAsync(db, currentTenant, cancellationToken);

        branch.IsActive = true;
        branch.UpdatedAt = DateTime.UtcNow;
        branch.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);
        cache.Forget();

        await auditService.LogAsync(
            AuditAction.BranchReopened,
            AuditEntityType.Branch,
            branch.Id.ToString(),
            newValues: new { branch.Name, branch.Code },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await BranchQueries.ListAsync(db, currentBranch, null, null, branch.Id, cancellationToken)).First();
    }
}

public class MakeMainBranchHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    ICurrentBranch currentBranch,
    BranchScopeCache cache) : IRequestHandler<MakeMainBranchCommand, BranchDto?>
{
    public async Task<BranchDto?> Handle(MakeMainBranchCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var branch = await BranchRules.AllOfShop(db).FirstOrDefaultAsync(b => b.Id == request.Id, cancellationToken);
        if (branch is null || (BranchRules.IsLimited(currentBranch) && !currentBranch.AllowedBranchIds.Contains(branch.Id)))
        {
            return null;
        }

        if (!branch.IsActive)
        {
            throw new InvalidOperationException("Reopen the branch before making it the main branch.");
        }

        if (!branch.IsMain)
        {
            var previous = await BranchRules.AllOfShop(db).FirstOrDefaultAsync(b => b.IsMain, cancellationToken);

            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            if (previous is not null)
            {
                previous.IsMain = false;
                await db.SaveChangesAsync(cancellationToken);
            }

            branch.IsMain = true;
            branch.UpdatedAt = DateTime.UtcNow;
            branch.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            cache.Forget();

            await auditService.LogAsync(
                AuditAction.BranchMainChanged,
                AuditEntityType.Branch,
                branch.Id.ToString(),
                oldValues: new { Main = previous?.Code },
                newValues: new { Main = branch.Code },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return (await BranchQueries.ListAsync(db, currentBranch, null, null, branch.Id, cancellationToken)).First();
    }
}

internal static class BranchClosing
{
    public static async Task<BranchCloseCheckDto?> CheckAsync(WTFDbContext db, ICurrentBranch currentBranch, Guid id, CancellationToken cancellationToken)
    {
        var branch = await BranchRules.AllOfShop(db).AsNoTracking().FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (branch is null || (BranchRules.IsLimited(currentBranch) && !currentBranch.AllowedBranchIds.Contains(branch.Id)))
        {
            return null;
        }

        var activeCount = await BranchRules.AllOfShop(db).CountAsync(b => b.IsActive, cancellationToken);
        var open = await BranchRules.AllOrdersOfShop(db).CountAsync(o => o.BranchId == id && BranchRules.OpenOrderStatuses.Contains(o.StatusId), cancellationToken);
        var held = await BranchRules.AllOrdersOfShop(db).CountAsync(o => o.BranchId == id && o.StatusId == (int)OrderStatusEnum.PendingReview, cancellationToken);
        var openPurchaseOrders = await db.PurchaseOrders.IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .CountAsync(p => p.BranchId == id && (p.Status == PurchaseOrderStatuses.Sent || p.Status == PurchaseOrderStatuses.PartlyReceived), cancellationToken);

        var staff = await db.UserBranches.AsNoTracking()
            .Where(u => u.BranchId == id && u.User.IsActive)
            .Select(u => new { u.UserId, u.User.FirstName, u.User.LastName, u.User.Username, u.User.BranchScope })
            .ToListAsync(cancellationToken);
        var staffIds = staff.Select(s => s.UserId).ToList();
        var otherBranchUsers = await db.UserBranches.AsNoTracking()
            .Where(u => staffIds.Contains(u.UserId) && u.BranchId != id && u.Branch.IsActive)
            .Select(u => u.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);

        // Someone who sees every branch is never left without one; only limited staff with no other open branch must be moved.
        var stranded = staff
            .Where(s => s.BranchScope == (byte)BranchScopeEnum.Selected && !otherBranchUsers.Contains(s.UserId))
            .Select(s => new BranchStaffDto(s.UserId, $"{s.FirstName} {s.LastName}".Trim(), s.Username))
            .ToList();

        var blockers = new List<string>();
        if (!branch.IsActive)
        {
            blockers.Add("This branch is already closed.");
        }

        if (branch.IsMain)
        {
            blockers.Add("This is the main branch. Make another branch the main branch first.");
        }

        if (branch.IsActive && activeCount <= 1)
        {
            blockers.Add("A shop always keeps one open branch.");
        }

        if (open > 0)
        {
            blockers.Add($"{open} {(open == 1 ? "order is" : "orders are")} still open at {branch.Name}. Finish or cancel {(open == 1 ? "it" : "them")} first.");
        }

        if (held > 0)
        {
            blockers.Add($"{held} offline {(held == 1 ? "order is" : "orders are")} waiting for review at {branch.Name}. Approve or reject {(held == 1 ? "it" : "them")} first.");
        }

        if (openPurchaseOrders > 0)
        {
            blockers.Add($"{openPurchaseOrders} purchase {(openPurchaseOrders == 1 ? "order is" : "orders are")} still open at {branch.Name}. Receive or cancel {(openPurchaseOrders == 1 ? "it" : "them")} first.");
        }

        return new BranchCloseCheckDto(branch.Id, branch.IsMain, activeCount <= 1, open, held, openPurchaseOrders, staff.Count, stranded, blockers.Count == 0, blockers);
    }
}
