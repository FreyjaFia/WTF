using WTF.Api.Features.Branches.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

// A person limited to some branches only sees, edits and removes the people who work in those branches (and themselves). A
// person who sees every branch is never listed for them, so they cannot be reset, deactivated or edited from a branch.
internal static class UserBranchVisibility
{
    public static IQueryable<User> VisibleTo(WTFDbContext db, Guid actorId)
    {
        if (!db.IsBranchLimited)
        {
            return db.Users;
        }

        var allowed = db.AllowedBranchIds.ToList();
        var links = db.UserBranches;
        var allScope = (byte)BranchScopeEnum.All;

        return db.Users.Where(u => u.Id == actorId
            || (u.BranchScope != allScope && links.Any(l => l.UserId == u.Id && allowed.Contains(l.BranchId))));
    }
}
