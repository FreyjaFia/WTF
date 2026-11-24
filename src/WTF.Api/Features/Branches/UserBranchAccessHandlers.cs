using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Branches.DTOs;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Branches;

public record UserBranchAccessRequest(bool IsAllBranches, List<Guid>? BranchIds, Guid? DefaultBranchId);

public record GetUserBranchAccessQuery(Guid UserId) : IRequest<UserBranchAccessDto?>;

public record SetUserBranchAccessCommand(Guid UserId, bool IsAllBranches, List<Guid>? BranchIds, Guid? DefaultBranchId) : IRequest<UserBranchAccessDto?>;

public class GetUserBranchAccessHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, ICurrentBranch currentBranch) : IRequestHandler<GetUserBranchAccessQuery, UserBranchAccessDto?>
{
    public async Task<UserBranchAccessDto?> Handle(GetUserBranchAccessQuery request, CancellationToken cancellationToken)
    {
        var user = await UserBranchVisibility.VisibleTo(db, httpContextAccessor.HttpContext!.User.GetUserId()).AsNoTracking().FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user is null)
        {
            return null;
        }

        var branchIds = await db.UserBranches.AsNoTracking()
            .Where(u => u.UserId == user.Id)
            .Select(u => u.BranchId)
            .ToListAsync(cancellationToken);

        // Someone limited to selected branches only sees the part of the list that is in their own branches.
        if (BranchRules.IsLimited(currentBranch))
        {
            branchIds = [.. branchIds.Where(currentBranch.AllowedBranchIds.Contains)];
        }

        return new UserBranchAccessDto(user.Id, BranchRules.ScopeOf(user) == BranchScopeEnum.All, branchIds, user.DefaultBranchId);
    }
}

public class SetUserBranchAccessHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    ICurrentBranch currentBranch,
    BranchScopeCache cache) : IRequestHandler<SetUserBranchAccessCommand, UserBranchAccessDto?>
{
    public async Task<UserBranchAccessDto?> Handle(SetUserBranchAccessCommand request, CancellationToken cancellationToken)
    {
        var actorId = httpContextAccessor.HttpContext!.User.GetUserId();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user is null)
        {
            return null;
        }

        var limitedActor = BranchRules.IsLimited(currentBranch);
        var requested = (request.BranchIds ?? []).Distinct().ToList();

        if (limitedActor && (user.BranchScope == (byte)BranchScopeEnum.All || !await UserIsInside(user.Id, currentBranch.AllowedBranchIds, cancellationToken)))
        {
            throw new ForbiddenActionException("You can only change people who work in your branches.");
        }

        if (request.IsAllBranches)
        {
            if (limitedActor)
            {
                throw new ForbiddenActionException("Only someone who works in every branch can give access to every branch.");
            }

            requested = [];
        }
        else
        {
            if (user.RoleId == (int)UserRoleEnum.Owner)
            {
                throw new InvalidOperationException("The owner always has access to every branch.");
            }

            if (requested.Count == 0)
            {
                throw new InvalidOperationException("Choose at least one branch.");
            }

            var found = await BranchRules.AllOfShop(db).Where(b => requested.Contains(b.Id)).Select(b => b.Id).ToListAsync(cancellationToken);
            if (found.Count != requested.Count)
            {
                throw new InvalidOperationException("One of the branches does not exist.");
            }

            if (limitedActor && requested.Any(id => !currentBranch.AllowedBranchIds.Contains(id)))
            {
                throw new ForbiddenActionException("You can only give access to branches you work in.");
            }
        }

        var before = await db.UserBranches.Where(u => u.UserId == user.Id).ToListAsync(cancellationToken);
        var beforeIds = before.Select(b => b.BranchId).ToList();

        List<Guid> finalIds;
        if (request.IsAllBranches)
        {
            // Keeping the rows lets the owner switch back to selected branches without choosing them again.
            finalIds = beforeIds;
        }
        else
        {
            // A limited manager only changes the part of the person's list that is inside their own branches.
            var protectedIds = limitedActor ? beforeIds.Where(id => !currentBranch.AllowedBranchIds.Contains(id)).ToList() : [];
            foreach (var row in before.Where(r => !protectedIds.Contains(r.BranchId) && !requested.Contains(r.BranchId)))
            {
                db.UserBranches.Remove(row);
            }

            foreach (var id in requested.Where(id => !beforeIds.Contains(id)))
            {
                db.UserBranches.Add(new UserBranch { UserId = user.Id, BranchId = id, CreatedAt = DateTime.UtcNow });
            }

            finalIds = [.. protectedIds, .. requested];
        }

        user.BranchScope = (byte)(request.IsAllBranches ? BranchScopeEnum.All : BranchScopeEnum.Selected);
        if (request.DefaultBranchId is { } preferred && (request.IsAllBranches || finalIds.Contains(preferred)) && (!limitedActor || currentBranch.AllowedBranchIds.Contains(preferred)))
        {
            user.DefaultBranchId = preferred;
        }
        else if (user.DefaultBranchId is { } current && !request.IsAllBranches && !finalIds.Contains(current))
        {
            user.DefaultBranchId = finalIds.FirstOrDefault();
        }

        user.UpdatedAt = DateTime.UtcNow;
        user.UpdatedBy = actorId;
        await db.SaveChangesAsync(cancellationToken);
        cache.Forget();

        await auditService.LogAsync(
            AuditAction.BranchScopeChanged,
            AuditEntityType.User,
            user.Id.ToString(),
            oldValues: new { BranchIds = beforeIds },
            newValues: new { request.IsAllBranches, BranchIds = finalIds, user.DefaultBranchId },
            userId: actorId,
            cancellationToken: cancellationToken);

        return new UserBranchAccessDto(user.Id, request.IsAllBranches, finalIds, user.DefaultBranchId);
    }

    private async Task<bool> UserIsInside(Guid userId, IReadOnlyCollection<Guid> allowed, CancellationToken cancellationToken)
    {
        return await db.UserBranches.AnyAsync(u => u.UserId == userId && allowed.Contains(u.BranchId), cancellationToken);
    }
}
