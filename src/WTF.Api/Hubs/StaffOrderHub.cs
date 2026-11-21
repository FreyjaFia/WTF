using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Auth;

namespace WTF.Api.Hubs;

/// <summary>
/// Real time for the staff who work with orders, chat messages above all. It is separate from the dashboard hub on
/// purpose: that one is for people who may open the dashboard, while cashiers, who answer customers, may only read
/// orders (or the kitchen board). Like the other hubs it only pushes "something changed"; it has no methods a client can call.
/// </summary>
[Authorize(Policy = AppPolicies.OrdersLive)]
public class StaffOrderHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await BranchGroups.JoinAsync(this, HubNames.Groups.StaffOrders, true);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await BranchGroups.JoinAsync(this, HubNames.Groups.StaffOrders, false);
        await base.OnDisconnectedAsync(exception);
    }
}
