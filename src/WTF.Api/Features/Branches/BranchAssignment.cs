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
    public static async Task AssignNewUserAsync(WTFDbContext db, User user, Guid? branchId, CancellationToken cancellationToken)
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
        user.BranchScope = (byte)DefaultScopeFor(user.RoleId);
        db.UserBranches.Add(new UserBranch { UserId = user.Id, BranchId = branch.Id, CreatedAt = DateTime.UtcNow });
    }

    public static BranchScopeEnum DefaultScopeFor(int roleId)
    {
        return roleId is (int)UserRoleEnum.Cashier or (int)UserRoleEnum.StockManager
            ? BranchScopeEnum.Selected
            : BranchScopeEnum.All;
    }
}
