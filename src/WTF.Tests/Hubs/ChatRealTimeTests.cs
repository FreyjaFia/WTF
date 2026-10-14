using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Security.Claims;
using System.Text.Encodings.Web;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Hubs;

/// <summary>
/// Chat and order news from the server to real SignalR clients, through the real hubs and notifier on a test server.
/// The unit tests check what the notifier asks the hubs to send; these check that it actually arrives, at the right
/// people only: the staff, the customer who owns the order, and nobody else.
/// </summary>
public sealed class ChatRealTimeTests : IAsyncLifetime
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly List<HubConnection> _connections = [];
    private WebApplication _app = null!;
    private TestServer _server = null!;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSignalR();
        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
        builder.Services.AddAppAuthorization();
        builder.Services.AddScoped<WTFDbContext>(_ => TestDb.Create(_db));
        builder.Services.AddSingleton(Substitute.For<IPushNotificationService>());
        builder.Services.AddScoped<IConversationNotifier, ConversationNotifier>();

        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapHub<StaffOrderHub>("/hubs/staff-orders");
        _app.MapHub<CustomerOrderHub>("/hubs/customer-orders");
        await _app.StartAsync();
        _server = _app.GetTestServer();
    }

    public async Task DisposeAsync()
    {
        foreach (var connection in _connections)
        {
            await connection.DisposeAsync();
        }

        await _app.DisposeAsync();
    }

    /// <summary>Everybody who asks with a staff token is a cashier; anyone else is anonymous.</summary>
    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Query["access_token"] != "staff")
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            var identity = new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, AppRoles.Cashier)],
                "Test");
            return Task.FromResult(AuthenticateResult.Success(
                new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
        }
    }

    // --- people ---

    private async Task<(Customer Customer, ShortLink Link, Order Order)> SeedAsync(string first = "Maria")
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = first,
            LastName = "Cruz",
            IsActive = true,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var link = NewLink(customer.Id);
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = Random.Shared.Next(1, 100000),
            CustomerId = customer.Id,
            Source = (byte)OrderSourceEnum.CustomerLink,
            StatusId = (int)OrderStatusEnum.Pending,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, customer, link, order);
        return (customer, link, order);
    }

    private ShortLink NewLink(Guid customerId) => new()
    {
        Id = Guid.NewGuid(),
        Token = OrderLinkToken.Generate(),
        TargetType = OrderLinkToken.TargetType,
        TargetId = customerId,
        CreatedAt = DateTime.UtcNow.AddHours(-1),
        CreatedBy = _staffId
    };

    private async Task SeedUsersAsync()
    {
        await TestDb.SaveAsync(_db,
            new User
            {
                Id = _staffId,
                Username = "ana",
                PasswordHash = "x",
                FirstName = "Ana",
                LastName = "Reyes",
                IsActive = true,
                RoleId = 2,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _staffId
            },
            new User
            {
                Id = Guid.NewGuid(),
                Username = SubmitPublicOrderHandler.SystemUsername,
                PasswordHash = "x",
                FirstName = "Customer",
                LastName = "Link",
                IsActive = false,
                RoleId = 2,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _staffId
            });
    }

    // --- clients ---

    private sealed class Listener
    {
        private readonly List<string> _events = [];
        public HubConnection Connection { get; }
        public Listener(HubConnection connection) => Connection = connection;

        /// <summary>Listens for an event with exactly the arguments the server sends for it.</summary>
        public void Listen(string name, params Type[] arguments)
        {
            Connection.On(name, arguments, _ =>
            {
                Record(name);
                return Task.CompletedTask;
            });
        }

        private void Record(string name)
        {
            lock (_events)
            {
                _events.Add(name);
            }
        }

        public int Count(string name)
        {
            lock (_events)
            {
                return _events.Count(e => e == name);
            }
        }

        public async Task<bool> HeardAsync(string name, TimeSpan? within = null)
        {
            var until = DateTime.UtcNow + (within ?? Wait);
            while (DateTime.UtcNow < until)
            {
                if (Count(name) > 0)
                {
                    return true;
                }

                await Task.Delay(25);
            }

            return false;
        }

        /// <summary>Gives the server a moment, then says whether the event never came.</summary>
        public async Task<bool> StayedSilentAsync(string name) => !await HeardAsync(name, TimeSpan.FromMilliseconds(400));
    }

    private async Task<Listener> ConnectAsync(string hub, string token)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(_server.BaseAddress, $"/hubs/{hub}?access_token={Uri.EscapeDataString(token)}"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _server.CreateHandler();
            })
            .Build();
        _connections.Add(connection);

        var listener = new Listener(connection);
        listener.Listen(HubNames.Events.OrderMessageReceived, typeof(Guid), typeof(Guid));
        listener.Listen(HubNames.Events.ConversationRead, typeof(Guid), typeof(Guid));
        listener.Listen(HubNames.Events.OrderStatusChanged, typeof(Guid));
        listener.Listen(HubNames.Events.LinkRevoked);
        await connection.StartAsync();
        // SignalR answers the handshake before the hub's OnConnectedAsync has added the connection to its groups, so
        // StartAsync can return a moment too early. Give the join time to finish before anything is sent.
        await Task.Delay(250);
        return listener;
    }

    private Task<Listener> StaffAsync() => ConnectAsync("staff-orders", "staff");

    private Task<Listener> CustomerPageAsync(ShortLink link) => ConnectAsync("customer-orders", link.Token);

    private async Task SendAsCustomerAsync(ShortLink link, Order order, string body = "Is 5pm ok?")
    {
        await using var scope = _app.Services.CreateAsyncScope();
        var handler = new SendPublicMessageHandler(
            scope.ServiceProvider.GetRequiredService<WTFDbContext>(), TestFakes.Audit(),
            scope.ServiceProvider.GetRequiredService<IConversationNotifier>(), TimeProvider.System);
        (await handler.Handle(new SendPublicMessageCommand(link.Token, order.Id, body), default)).ShouldNotBeNull();
    }

    private async Task SendAsStaffAsync(Order order, string body = "Yes!")
    {
        await using var scope = _app.Services.CreateAsyncScope();
        var handler = new SendStaffMessageHandler(
            scope.ServiceProvider.GetRequiredService<WTFDbContext>(), TestRequest.As(_staffId, AppRoles.Cashier),
            TestFakes.Audit(), scope.ServiceProvider.GetRequiredService<IConversationNotifier>());
        (await handler.Handle(new SendStaffMessageCommand(order.Id, body), default)).ShouldNotBeNull();
    }

    // === messages ===

    [Fact]
    public async Task ACustomersMessage_ReachesTheStaffAtOnce()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync();
        var staff = await StaffAsync();

        await SendAsCustomerAsync(link, order);

        (await staff.HeardAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue("staff were not told live");
    }

    [Fact]
    public async Task ACustomersMessage_AlsoReachesTheCustomersOtherOpenPages()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync();
        var thisPage = await CustomerPageAsync(link);
        var otherDevice = await CustomerPageAsync(link);

        await SendAsCustomerAsync(link, order);

        (await thisPage.HeardAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue();
        (await otherDevice.HeardAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue();
    }

    [Fact]
    public async Task AStaffReply_ReachesTheCustomersPageAtOnce_AndTheOtherStaff()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync();
        var customerPage = await CustomerPageAsync(link);
        var otherStaff = await StaffAsync();

        await SendAsStaffAsync(order);

        (await customerPage.HeardAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue("the customer was not told live");
        (await otherStaff.HeardAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue();
    }

    [Fact]
    public async Task AMessage_NeverReachesAnotherCustomer()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync("Maria");
        var (_, strangersLink, _) = await SeedAsync("Ben");
        var stranger = await CustomerPageAsync(strangersLink);

        await SendAsCustomerAsync(link, order);
        await SendAsStaffAsync(order);

        (await stranger.StayedSilentAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue();
    }

    [Fact]
    public async Task ACustomerWithoutAValidLink_HearsNothing()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync();
        var impostor = await ConnectAsync("customer-orders", "not-a-real-token");

        await SendAsCustomerAsync(link, order);

        (await impostor.StayedSilentAsync(HubNames.Events.OrderMessageReceived)).ShouldBeTrue();
    }

    // === reading and order changes ===

    [Fact]
    public async Task OpeningTheChat_UpdatesTheOtherStaffsBadges_ButNotTheCustomer()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync();
        await SendAsCustomerAsync(link, order);
        var otherStaff = await StaffAsync();
        var customerPage = await CustomerPageAsync(link);

        await using var scope = _app.Services.CreateAsyncScope();
        await new MarkConversationReadHandler(
                scope.ServiceProvider.GetRequiredService<WTFDbContext>(),
                scope.ServiceProvider.GetRequiredService<IConversationNotifier>())
            .Handle(new MarkOrderConversationReadCommand(order.Id), default);

        (await otherStaff.HeardAsync(HubNames.Events.ConversationRead)).ShouldBeTrue();
        (await customerPage.StayedSilentAsync(HubNames.Events.ConversationRead)).ShouldBeTrue();
    }

    [Fact]
    public async Task AnOrderThatChanged_ReachesItsCustomerAndTheStaff_ButNotAnotherCustomer()
    {
        await SeedUsersAsync();
        var (_, link, order) = await SeedAsync("Maria");
        var (_, strangersLink, _) = await SeedAsync("Ben");
        var customerPage = await CustomerPageAsync(link);
        var stranger = await CustomerPageAsync(strangersLink);
        var staff = await StaffAsync();

        await using var scope = _app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IConversationNotifier>().OrderChangedAsync(order, null, default);

        (await customerPage.HeardAsync(HubNames.Events.OrderStatusChanged)).ShouldBeTrue();
        (await stranger.StayedSilentAsync(HubNames.Events.OrderStatusChanged)).ShouldBeTrue();
        (await staff.HeardAsync(HubNames.Events.OrderStatusChanged)).ShouldBeTrue();
    }

    [Fact]
    public async Task ARevokedLink_SendsOnlyThePagesOpenedThroughIt_AwayAtOnce()
    {
        await SeedUsersAsync();
        var (customer, link, _) = await SeedAsync();
        var secondLink = NewLink(customer.Id);
        await TestDb.SaveAsync(_db, secondLink);
        var throughRevoked = await CustomerPageAsync(link);
        var throughOther = await CustomerPageAsync(secondLink);

        await using var scope = _app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IConversationNotifier>().LinkRevokedAsync(link.Id, default);

        (await throughRevoked.HeardAsync(HubNames.Events.LinkRevoked)).ShouldBeTrue();
        (await throughOther.StayedSilentAsync(HubNames.Events.LinkRevoked)).ShouldBeTrue();
    }

    // === who may listen ===

    [Fact]
    public async Task TheStaffHub_RefusesAnAnonymousVisitor()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(_server.BaseAddress, "/hubs/staff-orders"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => _server.CreateHandler();
            })
            .Build();
        _connections.Add(connection);

        await Should.ThrowAsync<HttpRequestException>(() => connection.StartAsync());
    }
}
