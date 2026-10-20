using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Extensions;

namespace WTF.Api.Hubs;

/// <summary>
/// Real time for every signed-in person: their own notification count changed, and (for people who look after stock)
/// an item's stock changed. Like the other hubs it only says "something changed"; the page then asks the API, so a
/// client can never read or write through it. It has no methods a client can call.
/// </summary>
[Authorize]
public class NotificationHub(IAuthorizationService authorization) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        await Groups.AddToGroupAsync(Context.ConnectionId, HubNames.Groups.User(user.GetUserId()));

        var stock = await authorization.AuthorizeAsync(user, AppPolicies.StockMovementsRead);
        if (stock.Succeeded)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, HubNames.Groups.StockViewers);
        }

        await base.OnConnectedAsync();
    }
}
