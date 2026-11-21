using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Tenancy;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Hubs;

// A live screen only hears about the branches its person may see, so a kitchen tablet in one branch never refreshes for
// another branch's order. A connection joins one group per allowed branch (everyone assigned to the branch, or every branch
// for people who see all of them); new assignments take effect the next time the screen connects.
internal static class BranchGroups
{
    public static async Task<IReadOnlyList<Guid>> AllowedBranchIdsAsync(HubCallerContext context)
    {
        var http = context.GetHttpContext();
        var user = context.User;
        if (http is null
            || !Guid.TryParse(user?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var userId))
        {
            return [];
        }

        var tenantId = HubNames.Groups.TenantOf(user) ?? TenantDefaults.DefaultTenantId;

        var db = http.RequestServices.GetRequiredService<WTFDbContext>();
        var cache = http.RequestServices.GetRequiredService<BranchScopeCache>();
        var scope = await cache.GetUserAsync(db, userId, context.ConnectionAborted);
        var branches = await cache.GetBranchesAsync(db, tenantId, context.ConnectionAborted);
        return [.. branches.Where(b => scope.IsAll || scope.Assigned.Contains(b.Id)).Select(b => b.Id)];
    }

    public static async Task JoinAsync(Hub hub, Func<Guid?, Guid, string> groupFor, bool join)
    {
        var tenant = HubNames.Groups.TenantOf(hub.Context.User);
        foreach (var branchId in await AllowedBranchIdsAsync(hub.Context))
        {
            var group = groupFor(tenant, branchId);
            if (join)
            {
                await hub.Groups.AddToGroupAsync(hub.Context.ConnectionId, group);
            }
            else
            {
                await hub.Groups.RemoveFromGroupAsync(hub.Context.ConnectionId, group);
            }
        }
    }
}
