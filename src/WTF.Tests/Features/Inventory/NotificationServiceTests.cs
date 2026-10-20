using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using WTF.Api.Features.Notifications;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class NotificationServiceTests
{
    private readonly string _db = TestDb.NewName();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly IHubContext<NotificationHub> _hub = Substitute.For<IHubContext<NotificationHub>>();
    private readonly IClientProxy _client = Substitute.For<IClientProxy>();
    private readonly Guid _a = Guid.NewGuid();
    private readonly Guid _b = Guid.NewGuid();

    public NotificationServiceTests()
    {
        _hub.Clients.Group(Arg.Any<string>()).Returns(_client);
    }

    private NotificationService Service() => new(TestDb.Create(_db), _push, _hub);

    private static NotificationMessage Message(string kind = "OrderHeld") =>
        new(kind, NotificationSeverity.Warning, "Order held", "Order #5 needs review.", "/orders/details/5", Guid.NewGuid());

    [Fact]
    public async Task Notify_SavesOneRowPerPerson_WithEverythingTheKindSent()
    {
        var message = Message();

        await Service().NotifyAsync([_a, _b, _a], message, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var rows = await db.Notifications.AsNoTracking().ToListAsync();
        rows.Select(r => r.UserId).ShouldBe([_a, _b], ignoreOrder: true);
        rows.ShouldAllBe(r => r.Kind == "OrderHeld" && r.Severity == 1 && r.Title == "Order held" && r.Path == "/orders/details/5"
            && r.SubjectId == message.SubjectId && r.ReadAt == null);
    }

    [Fact]
    public async Task Notify_TellsEachPersonsOpenScreens_AndPushesToTheirDevices()
    {
        await Service().NotifyAsync([_a, _b], Message(), CancellationToken.None);

        _hub.Clients.Received(1).Group(HubNames.Groups.User(_a));
        _hub.Clients.Received(1).Group(HubNames.Groups.User(_b));
        await _client.Received(2).SendCoreAsync(HubNames.Events.NotificationsChanged, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
        await _push.Received(1).SendNotificationAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 2), "Order held", "Order #5 needs review.", "/orders/details/5", "OrderHeld",
            Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Notify_NobodyToTell_DoesNothing()
    {
        await Service().NotifyAsync([], Message(), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Notifications.CountAsync()).ShouldBe(0);
        await _push.DidNotReceiveWithAnyArgs().SendNotificationAsync(default!, default!, default!, default, default!, default, default);
    }

    [Fact]
    public async Task APushThatFails_DoesNotLoseTheNotification()
    {
        _push.SendNotificationAsync(default!, default!, default!, default, default!, default, default)
            .ThrowsAsyncForAnyArgs(new InvalidOperationException("boom"));

        await Should.NotThrowAsync(() => Service().NotifyAsync([_a], Message(), CancellationToken.None));

        await using var db = TestDb.Create(_db);
        (await db.Notifications.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task ALiveUpdateThatFails_DoesNotLoseTheNotification()
    {
        _client.SendCoreAsync(default!, default!, default).ThrowsAsyncForAnyArgs(new InvalidOperationException("socket"));

        await Should.NotThrowAsync(() => Service().NotifyAsync([_a], Message(), CancellationToken.None));

        await using var db = TestDb.Create(_db);
        (await db.Notifications.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Announce_SavesNothing_ButTellsScreensAndDevices()
    {
        await Service().AnnounceAsync([_a], Message(), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Notifications.CountAsync()).ShouldBe(0);
        await _client.Received(1).SendCoreAsync(HubNames.Events.NotificationsChanged, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
        await _push.ReceivedWithAnyArgs(1).SendNotificationAsync(default!, default!, default!, default, default!, default, default);
    }

    [Fact]
    public async Task StockChanged_GoesToTheStockViewersWithTheItem()
    {
        var item = Guid.NewGuid();

        await Service().StockChangedAsync(item, CancellationToken.None);

        _hub.Clients.Received(1).Group(HubNames.Groups.StockViewers);
        await _client.Received(1).SendCoreAsync(
            HubNames.Events.StockChanged, Arg.Is<object?[]>(args => (Guid)args[0]! == item), Arg.Any<CancellationToken>());
    }
}
