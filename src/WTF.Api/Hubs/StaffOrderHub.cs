using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Auth;

namespace WTF.Api.Hubs;

/// <summary>
/// Real time for the staff who work with orders, chat messages above all. It is separate from the dashboard hub on
/// purpose: that one is for people who may open the dashboard, while cashiers, who answer customers, may only read
/// orders. Like the other hubs it only pushes "something changed"; it has no methods a client can call.
/// </summary>
[Authorize(Policy = AppPolicies.OrdersRead)]
public class StaffOrderHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, HubNames.Groups.StaffOrders);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, HubNames.Groups.StaffOrders);
        await base.OnDisconnectedAsync(exception);
    }
}
