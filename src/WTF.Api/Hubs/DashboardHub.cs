using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Auth;

namespace WTF.Api.Hubs;

[Authorize(Policy = AppPolicies.DashboardRead)]
public class DashboardHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await BranchGroups.JoinAsync(this, HubNames.Groups.DashboardViewers, true);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await BranchGroups.JoinAsync(this, HubNames.Groups.DashboardViewers, false);
        await base.OnDisconnectedAsync(exception);
    }
}
