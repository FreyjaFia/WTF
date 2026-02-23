using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Auth;

namespace WTF.Api.Hubs;

[Authorize(Policy = AppPolicies.DashboardRead)]
public class DashboardHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, HubNames.Groups.DashboardViewers);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, HubNames.Groups.DashboardViewers);
        await base.OnDisconnectedAsync(exception);
    }
}
