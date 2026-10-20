using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Notifications;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class NotificationHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _me = Guid.NewGuid();
    private readonly Guid _other = Guid.NewGuid();

    private async Task<Guid> Add(Guid userId, string kind = "StockAlert", byte severity = 1, bool read = false, int minutesAgo = 0, string title = "Low stock: Milk")
    {
        await using var db = TestDb.Create(_db);
        var row = new Notification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = kind,
            Severity = severity,
            Title = title,
            Body = "400 ml left.",
            Path = "/inventory/items/details/1",
            SubjectId = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow.AddMinutes(-minutesAgo),
            ReadAt = read ? DateTime.UtcNow : null
        };
        db.Notifications.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    }

    private GetNotificationsHandler List() => new(TestDb.Create(_db), TestRequest.As(_me));

    private MarkNotificationsReadHandler Mark(INotificationService? notifications = null) =>
        new(TestDb.Create(_db), TestRequest.As(_me), notifications ?? TestFakes.Notifications(TestDb.Create(_db)));

    [Fact]
    public async Task List_ShowsOnlyMyRows_NewestFirst_WithCounts()
    {
        await Add(_me, minutesAgo: 30, title: "Old");
        await Add(_me, minutesAgo: 1, title: "New");
        await Add(_me, read: true, minutesAgo: 10, title: "Read");
        await Add(_other, title: "Not mine");

        var result = await List().Handle(new GetNotificationsQuery(), CancellationToken.None);

        result.Items.Select(i => i.Title).ShouldBe(["New", "Read", "Old"]);
        result.TotalCount.ShouldBe(3);
        result.UnreadCount.ShouldBe(2);
        result.UnreadByKind["StockAlert"].ShouldBe(2);
    }

    [Fact]
    public async Task List_FiltersByKindAndUnread()
    {
        await Add(_me, "StockAlert");
        await Add(_me, "OrderHeld");
        await Add(_me, "OrderHeld", read: true);

        var held = await List().Handle(new GetNotificationsQuery(Kind: "OrderHeld"), CancellationToken.None);
        var unreadHeld = await List().Handle(new GetNotificationsQuery(Kind: "OrderHeld", UnreadOnly: true), CancellationToken.None);

        held.TotalCount.ShouldBe(2);
        unreadHeld.TotalCount.ShouldBe(1);
        unreadHeld.UnreadByKind.ShouldBe(new Dictionary<string, int> { ["StockAlert"] = 1, ["OrderHeld"] = 1 });
    }

    [Fact]
    public async Task List_MapsSeverityToAName_AndPages()
    {
        await Add(_me, severity: 2, minutesAgo: 3);
        await Add(_me, severity: 1, minutesAgo: 2);
        await Add(_me, severity: 0, minutesAgo: 1);

        var first = await List().Handle(new GetNotificationsQuery(Page: 1, PageSize: 2), CancellationToken.None);
        var second = await List().Handle(new GetNotificationsQuery(Page: 2, PageSize: 2), CancellationToken.None);

        first.Items.Select(i => i.Severity).ShouldBe(["Info", "Warning"]);
        second.Items.Single().Severity.ShouldBe("Critical");
        first.TotalCount.ShouldBe(3);
    }

    [Fact]
    public async Task Counts_AreTheSumOfTheKinds()
    {
        await Add(_me, "StockAlert");
        await Add(_me, "StockAlert");
        await Add(_me, "OrderHeld");
        await Add(_other, "OrderHeld");

        var counts = await new GetNotificationCountsHandler(TestDb.Create(_db), TestRequest.As(_me))
            .Handle(new GetNotificationCountsQuery(), CancellationToken.None);

        counts.UnreadCount.ShouldBe(3);
        counts.UnreadByKind.Values.Sum().ShouldBe(counts.UnreadCount);
    }

    [Fact]
    public async Task MarkRead_SomeIds_LeavesTheRest_AndReturnsTheCounts()
    {
        var a = await Add(_me);
        await Add(_me);

        var counts = await Mark().Handle(new MarkNotificationsReadCommand([a]), CancellationToken.None);

        counts.UnreadCount.ShouldBe(1);
        await using var db = TestDb.Create(_db);
        (await db.Notifications.SingleAsync(n => n.Id == a)).ReadAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task MarkRead_AKind_OnlyClearsThatKind()
    {
        await Add(_me, "StockAlert");
        await Add(_me, "OrderHeld");

        var counts = await Mark().Handle(new MarkNotificationsReadCommand(Kind: "OrderHeld"), CancellationToken.None);

        counts.UnreadByKind.ShouldBe(new Dictionary<string, int> { ["StockAlert"] = 1 });
    }

    [Fact]
    public async Task MarkRead_All_ClearsEverythingOfMine_AndNothingOfAnyoneElse()
    {
        await Add(_me);
        await Add(_me, "OrderHeld");
        var theirs = await Add(_other);

        var counts = await Mark().Handle(new MarkNotificationsReadCommand(), CancellationToken.None);

        counts.UnreadCount.ShouldBe(0);
        await using var db = TestDb.Create(_db);
        (await db.Notifications.SingleAsync(n => n.Id == theirs)).ReadAt.ShouldBeNull();
    }

    [Fact]
    public async Task MarkRead_SomeoneElsesId_ChangesNothing()
    {
        var theirs = await Add(_other);

        await Mark().Handle(new MarkNotificationsReadCommand([theirs]), CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Notifications.SingleAsync(n => n.Id == theirs)).ReadAt.ShouldBeNull();
    }

    [Fact]
    public async Task MarkRead_TellsMyOtherDevices_OnlyWhenSomethingChanged()
    {
        var notifications = Substitute.For<INotificationService>();
        await Add(_me);

        await Mark(notifications).Handle(new MarkNotificationsReadCommand(), CancellationToken.None);
        await Mark(notifications).Handle(new MarkNotificationsReadCommand(), CancellationToken.None);

        await notifications.Received(1).CountsChangedAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Single() == _me), Arg.Any<CancellationToken>());
    }
}
