using Microsoft.AspNetCore.SignalR;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Kitchen;

internal static class KitchenNotify
{
    // The boards (and the order list) refetch on this message, so a missed one never leaves a screen wrong for long.
    public static async Task OrderChangedAsync(
        IHubContext<DashboardHub> dashboardHub, IConversationNotifier conversationNotifier, Order order, CancellationToken cancellationToken)
    {
        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers(order.TenantId, order.BranchId))
            .SendAsync(HubNames.Events.OrderUpdated, order.Id, cancellationToken);
        await conversationNotifier.OrderChangedAsync(order, null, cancellationToken);
    }
}
