using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Branches;

public static class BranchAssignment
{
    // A new person starts in the branch where they were added (Main when none is named). Cashiers and Stock Managers are limited
    // to it; every other role keeps seeing all branches, as before branches existed.
    public static async Task AssignNewUserAsync(WTFDbContext db, User user, Guid? branchId, CancellationToken cancellationToken, bool forceSelected = false)
    {
        var tenantId = db.StampTenantId;
        var branch = await db.Branches.IgnoreQueryFilters()
            .Where(b => b.TenantId == tenantId && (branchId != null ? b.Id == branchId : b.IsMain))
            .Select(b => new { b.Id })
            .FirstOrDefaultAsync(cancellationToken);

        if (branch is null)
        {
            return;
        }

        user.DefaultBranchId = branch.Id;
        user.BranchScope = (byte)(forceSelected ? BranchScopeEnum.Selected : DefaultScopeFor(user.RoleId));
        db.UserBranches.Add(new UserBranch { UserId = user.Id, BranchId = branch.Id, CreatedAt = DateTime.UtcNow });
    }

    // A person moved to a role that works in one branch (Cashier, Stock Manager, Kitchen) stops seeing every branch: they get the
    // branch they were last working in. The other direction is left alone, because a limited person with a shop-wide role keeps
    // only the keys a limited person may hold.
    public static async Task RescopeForRoleChangeAsync(WTFDbContext db, User user, int newRoleId, CancellationToken cancellationToken)
    {
        if (DefaultScopeFor(newRoleId) != BranchScopeEnum.Selected || user.BranchScope != (byte)BranchScopeEnum.All)
        {
            return;
        }

        user.BranchScope = (byte)BranchScopeEnum.Selected;
        if (await db.UserBranches.AnyAsync(u => u.UserId == user.Id, cancellationToken))
        {
            return;
        }

        var tenantId = db.StampTenantId;
        var branchId = user.DefaultBranchId ?? db.ActiveBranchId
            ?? await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == tenantId && b.IsMain).Select(b => (Guid?)b.Id).FirstOrDefaultAsync(cancellationToken);
        if (branchId is { } id)
        {
            user.DefaultBranchId = id;
            db.UserBranches.Add(new UserBranch { UserId = user.Id, BranchId = id, CreatedAt = DateTime.UtcNow });
        }
    }

    public static BranchScopeEnum DefaultScopeFor(int roleId)
    {
        return roleId is (int)UserRoleEnum.Cashier or (int)UserRoleEnum.StockManager or (int)UserRoleEnum.Kitchen
            ? BranchScopeEnum.Selected
            : BranchScopeEnum.All;
    }
}
