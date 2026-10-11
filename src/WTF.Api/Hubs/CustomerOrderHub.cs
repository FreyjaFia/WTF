using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using WTF.Api.Features.OrderLinks;
using WTF.Domain.Data;

namespace WTF.Api.Hubs;

/// <summary>
/// Real time for a customer on their ordering page. It is anonymous, so the connection is only ever allowed after the
/// ordering link token (sent as the <c>access_token</c> query value) passes the same check every public route runs;
/// anything else is aborted at once. The server only pushes (new messages, order changes, link revoked): there are
/// no methods a client can call to read or write anything, so a connection can never act, only listen.
/// </summary>
public class CustomerOrderHub(WTFDbContext db, ILogger<CustomerOrderHub> logger) : Hub
{
    /// <summary>Open connections one address may hold, so the hub cannot be used to exhaust the server.</summary>
    public const int MaxConnectionsPerAddress = 10;

    private static readonly ConcurrentDictionary<string, int> ConnectionsByAddress = new();
    private const string AddressKey = "address";

    public override async Task OnConnectedAsync()
    {
        var http = Context.GetHttpContext();
        var token = http?.Request.Query["access_token"].ToString();
        var address = http?.Connection.RemoteIpAddress?.ToString() ?? "local";

        var access = await OrderLinkAccess.ResolveAsync(db, token, Context.ConnectionAborted);
        if (access == null)
        {
            logger.LogInformation("Customer hub connection refused: the link is not valid.");
            Context.Abort();
            return;
        }

        var count = ConnectionsByAddress.AddOrUpdate(address, 1, (_, current) => current + 1);
        if (count > MaxConnectionsPerAddress)
        {
            ConnectionsByAddress.AddOrUpdate(address, 0, (_, current) => Math.Max(0, current - 1));
            logger.LogWarning("Customer hub connection refused: too many connections from one address.");
            Context.Abort();
            return;
        }

        Context.Items[AddressKey] = address;
        await Groups.AddToGroupAsync(Context.ConnectionId, HubNames.Groups.Customer(access.Customer.Id));
        await Groups.AddToGroupAsync(Context.ConnectionId, HubNames.Groups.Link(access.Link.Id));
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(AddressKey, out var address) && address is string key)
        {
            ConnectionsByAddress.AddOrUpdate(key, 0, (_, current) => Math.Max(0, current - 1));
        }

        await base.OnDisconnectedAsync(exception);
    }
}
