using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using System.Net;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Hubs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Hubs;

/// <summary>The customer hub is anonymous, so the token check at connection time is the only thing keeping it private.</summary>
public class CustomerOrderHubTests
{
    private static int _address;

    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();

    /// <summary>The hub counts connections per address across the whole process, so every test uses its own.</summary>
    private readonly string _ip = $"10.20.{Interlocked.Increment(ref _address) % 250}.{Random.Shared.Next(1, 250)}";

    private async Task<(Customer Customer, ShortLink Link)> SeedAsync(
        DateTime? revokedAt = null, DateTime? expiresAt = null, bool allow = true, bool active = true)
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = active,
            AllowOrderingLink = allow,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = customer.Id,
            RevokedAt = revokedAt,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow.AddHours(-1),
            CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, customer, link);
        return (customer, link);
    }

    private sealed record Connection(CustomerOrderHub Hub, HubCallerContext Context, IGroupManager Groups);

    private Connection Connect(string? token, string? ip = null)
    {
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = IPAddress.Parse(ip ?? _ip);
        if (token != null)
        {
            http.Request.QueryString = new QueryString($"?access_token={Uri.EscapeDataString(token)}");
        }

        var feature = Substitute.For<IHttpContextFeature>();
        feature.HttpContext.Returns(http);
        var features = new FeatureCollection();
        features.Set(feature);

        var context = Substitute.For<HubCallerContext>();
        context.ConnectionId.Returns(Guid.NewGuid().ToString());
        context.Items.Returns(new Dictionary<object, object?>());
        context.Features.Returns(features);
        context.ConnectionAborted.Returns(CancellationToken.None);

        var groups = Substitute.For<IGroupManager>();
        var hub = new CustomerOrderHub(TestDb.Create(_db), NullLogger<CustomerOrderHub>.Instance)
        {
            Context = context,
            Groups = groups
        };
        return new Connection(hub, context, groups);
    }

    // --- who may connect ---

    [Fact]
    public async Task AValidLink_JoinsItsCustomersGroupAndItsOwnLinkGroup()
    {
        var (customer, link) = await SeedAsync();
        var c = Connect(link.Token);

        await c.Hub.OnConnectedAsync();

        c.Context.DidNotReceive().Abort();
        await c.Groups.Received(1).AddToGroupAsync(c.Context.ConnectionId, HubNames.Groups.Customer(customer.Id), Arg.Any<CancellationToken>());
        await c.Groups.Received(1).AddToGroupAsync(c.Context.ConnectionId, HubNames.Groups.Link(link.Id), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-real-token")]
    public async Task AMissingOrUnknownToken_IsAbortedAtOnce_AndJoinsNothing(string? token)
    {
        await SeedAsync();
        var c = Connect(token);

        await c.Hub.OnConnectedAsync();

        c.Context.Received(1).Abort();
        await c.Groups.DidNotReceiveWithAnyArgs().AddToGroupAsync(default!, default!, default);
    }

    [Fact]
    public async Task ARevokedLink_IsAborted()
    {
        var (_, link) = await SeedAsync(revokedAt: DateTime.UtcNow.AddMinutes(-1));
        var c = Connect(link.Token);

        await c.Hub.OnConnectedAsync();

        c.Context.Received(1).Abort();
        await c.Groups.DidNotReceiveWithAnyArgs().AddToGroupAsync(default!, default!, default);
    }

    [Fact]
    public async Task AnExpiredLink_IsAborted()
    {
        var (_, link) = await SeedAsync(expiresAt: DateTime.UtcNow.AddMinutes(-1));
        var c = Connect(link.Token);

        await c.Hub.OnConnectedAsync();

        c.Context.Received(1).Abort();
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task ACustomerWhoCanNoLongerOrder_IsAborted(bool allow, bool active)
    {
        var (_, link) = await SeedAsync(allow: allow, active: active);
        var c = Connect(link.Token);

        await c.Hub.OnConnectedAsync();

        c.Context.Received(1).Abort();
    }

    [Fact]
    public async Task ATokenWithTheWrongCase_IsAborted_BecauseTokensAreCaseSensitive()
    {
        var (_, link) = await SeedAsync();
        var c = Connect(link.Token.ToUpperInvariant() == link.Token ? link.Token.ToLowerInvariant() : link.Token.ToUpperInvariant());

        await c.Hub.OnConnectedAsync();

        c.Context.Received(1).Abort();
    }

    // --- how many connections one address may hold ---

    [Fact]
    public async Task AnAddress_CanHoldOnlyTenConnections_AndFreesASlotWhenOneCloses()
    {
        var (_, link) = await SeedAsync();
        var open = new List<Connection>();
        for (var i = 0; i < CustomerOrderHub.MaxConnectionsPerAddress; i++)
        {
            var ok = Connect(link.Token);
            await ok.Hub.OnConnectedAsync();
            ok.Context.DidNotReceive().Abort();
            open.Add(ok);
        }

        var tooMany = Connect(link.Token);
        await tooMany.Hub.OnConnectedAsync();
        tooMany.Context.Received(1).Abort();
        await tooMany.Groups.DidNotReceiveWithAnyArgs().AddToGroupAsync(default!, default!, default);

        await open[0].Hub.OnDisconnectedAsync(null);

        var again = Connect(link.Token);
        await again.Hub.OnConnectedAsync();
        again.Context.DidNotReceive().Abort();
    }

    [Fact]
    public async Task AnotherAddress_IsNotAffectedByTheLimit()
    {
        var (_, link) = await SeedAsync();
        for (var i = 0; i < CustomerOrderHub.MaxConnectionsPerAddress; i++)
        {
            await Connect(link.Token).Hub.OnConnectedAsync();
        }

        var elsewhere = Connect(link.Token, ip: "10.99.99.99");
        await elsewhere.Hub.OnConnectedAsync();

        elsewhere.Context.DidNotReceive().Abort();
    }

    [Fact]
    public async Task ARefusedConnection_DoesNotUseUpASlot()
    {
        var (_, link) = await SeedAsync();
        for (var i = 0; i < 20; i++)
        {
            await Connect("bad-token").Hub.OnConnectedAsync();
        }

        var good = Connect(link.Token);
        await good.Hub.OnConnectedAsync();

        good.Context.DidNotReceive().Abort();
    }

    // --- nothing a client can call ---

    [Fact]
    public void TheHub_HasNoMethodsAClientCanCall()
    {
        // SignalR lets a client invoke any public method a hub declares. This hub only listens, so it declares none.
        var callable = typeof(CustomerOrderHub)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance
                        | System.Reflection.BindingFlags.DeclaredOnly)
            .Where(m => m.Name is not ("OnConnectedAsync" or "OnDisconnectedAsync"))
            .Select(m => m.Name);

        callable.ShouldBeEmpty();
    }

    [Fact]
    public void TheStaffHub_RequiresTheOrdersReadPolicy_AndHasNoCallableMethods()
    {
        var authorize = typeof(StaffOrderHub)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), false)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Single();
        authorize.Policy.ShouldBe(WTF.Api.Common.Auth.AppPolicies.OrdersRead);

        typeof(StaffOrderHub)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance
                        | System.Reflection.BindingFlags.DeclaredOnly)
            .Where(m => m.Name is not ("OnConnectedAsync" or "OnDisconnectedAsync"))
            .ShouldBeEmpty();
    }

    [Fact]
    public void TheDashboardHub_StillRequiresTheDashboardReadPolicy()
    {
        typeof(DashboardHub)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), false)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Single().Policy.ShouldBe(WTF.Api.Common.Auth.AppPolicies.DashboardRead);
    }
}
