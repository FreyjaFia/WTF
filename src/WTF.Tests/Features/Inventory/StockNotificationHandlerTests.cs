using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class StockNotificationHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _me = Guid.NewGuid();
    private readonly Guid _other = Guid.NewGuid();
    private readonly Guid _milk;
    private readonly IAuditService _audit = TestFakes.Audit();

    public StockNotificationHandlerTests()
    {
        using (var db = TestDb.Create(_db))
        {
            db.UserRoles.AddRange(
                new UserRole { Id = 1, Name = AppRoles.Admin },
                new UserRole { Id = 2, Name = AppRoles.Cashier },
                new UserRole { Id = 3, Name = AppRoles.AdminViewer },
                new UserRole { Id = 6, Name = AppRoles.StockManager });
            db.SaveChanges();
        }

        _milk = StockSeed.Item(_db, "Oat Milk", 100m);
    }

    private void AddUser(Guid id, int roleId, bool active = true, string first = "Al")
    {
        using var db = TestDb.Create(_db);
        db.Users.Add(new User { Id = id, Username = $"u-{id:N}", PasswordHash = "x", FirstName = first, LastName = "Em", IsActive = active, RoleId = roleId });
        db.SaveChanges();
    }

    private void AddNotification(Guid userId, DateTime at, bool read = false, string title = "Low stock: Oat Milk")
    {
        using var db = TestDb.Create(_db);
        db.StockNotifications.Add(new StockNotification
        {
            UserId = userId,
            ItemId = _milk,
            Status = 1,
            Quantity = 100m,
            Title = title,
            Body = "100 ml left.",
            CreatedAt = at,
            ReadAt = read ? at.AddMinutes(1) : null
        });
        db.SaveChanges();
    }

    private GetStockNotificationsHandler List() => new(TestDb.Create(_db), TestRequest.As(_me, AppRoles.Admin));

    private MarkStockNotificationsReadHandler Mark() => new(TestDb.Create(_db), TestRequest.As(_me, AppRoles.Admin));

    [Fact]
    public async Task List_ShowsOnlyMyNotifications_NewestFirst_WithTheUnreadCount()
    {
        var now = new DateTime(2026, 10, 21, 8, 0, 0, DateTimeKind.Utc);
        AddNotification(_me, now.AddHours(-2), title: "older");
        AddNotification(_me, now, title: "newer");
        AddNotification(_me, now.AddHours(-1), read: true, title: "read one");
        AddNotification(_other, now, title: "someone else's");

        var result = await List().Handle(new GetStockNotificationsQuery(), CancellationToken.None);

        result.Items.Select(n => n.Title).ShouldBe(["newer", "read one", "older"]);
        result.TotalCount.ShouldBe(3);
        result.UnreadCount.ShouldBe(2);
        result.Items[0].ItemName.ShouldBe("Oat Milk");
        result.Items[0].Status.ShouldBe("Warning");
        result.Items[1].IsRead.ShouldBeTrue();
    }

    [Fact]
    public async Task List_CanShowUnreadOnly_AndPages()
    {
        var now = new DateTime(2026, 10, 21, 8, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 5; i++)
        {
            AddNotification(_me, now.AddMinutes(i), read: i == 4, title: $"n{i}");
        }

        var unread = await List().Handle(new GetStockNotificationsQuery(UnreadOnly: true), CancellationToken.None);
        var page = await List().Handle(new GetStockNotificationsQuery(Page: 2, PageSize: 2), CancellationToken.None);

        unread.Items.Count.ShouldBe(4);
        unread.TotalCount.ShouldBe(4);
        page.Items.Select(n => n.Title).ShouldBe(["n2", "n1"]);
        page.TotalCount.ShouldBe(5);
    }

    [Fact]
    public async Task MarkRead_WithIds_MarksOnlyThoseAndReturnsWhatIsLeft()
    {
        var now = new DateTime(2026, 10, 21, 8, 0, 0, DateTimeKind.Utc);
        AddNotification(_me, now);
        AddNotification(_me, now.AddMinutes(1));
        var first = (await List().Handle(new GetStockNotificationsQuery(), CancellationToken.None)).Items[0].Id;

        var unread = await Mark().Handle(new MarkStockNotificationsReadCommand([first]), CancellationToken.None);

        unread.ShouldBe(1);
    }

    [Fact]
    public async Task MarkRead_WithoutIds_MarksAllOfMineAndNeverSomeoneElses()
    {
        var now = new DateTime(2026, 10, 21, 8, 0, 0, DateTimeKind.Utc);
        AddNotification(_me, now);
        AddNotification(_me, now.AddMinutes(1));
        AddNotification(_other, now);

        var unread = await Mark().Handle(new MarkStockNotificationsReadCommand(), CancellationToken.None);

        unread.ShouldBe(0);
        await using var db = TestDb.Create(_db);
        (await db.StockNotifications.CountAsync(n => n.UserId == _other && n.ReadAt == null)).ShouldBe(1);
    }

    [Fact]
    public async Task MarkRead_AnIdOfSomeoneElse_ChangesNothing()
    {
        var now = new DateTime(2026, 10, 21, 8, 0, 0, DateTimeKind.Utc);
        AddNotification(_other, now);
        Guid theirs;
        await using (var db = TestDb.Create(_db))
        {
            theirs = (await db.StockNotifications.SingleAsync()).Id;
        }

        await Mark().Handle(new MarkStockNotificationsReadCommand([theirs]), CancellationToken.None);

        await using var check = TestDb.Create(_db);
        (await check.StockNotifications.SingleAsync()).ReadAt.ShouldBeNull();
    }

    // ---- per-item recipients ----

    private GetItemAlertRecipientsHandler GetRecipients() => new(TestDb.Create(_db));

    private SetItemAlertRecipientsHandler SetRecipients() => new(TestDb.Create(_db), TestRequest.As(_me, AppRoles.Admin), _audit);

    [Fact]
    public async Task Recipients_UnknownItem_IsNull()
    {
        (await GetRecipients().Handle(new GetItemAlertRecipientsQuery(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
        (await SetRecipients().Handle(new SetItemAlertRecipientsCommand(Guid.NewGuid(), []), CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Recipients_ListTheCandidatesAndTheDefault_WithNobodySelectedAtFirst()
    {
        var admin = Guid.NewGuid();
        var cashier = Guid.NewGuid();
        AddUser(admin, 1, first: "Ana");
        AddUser(cashier, 2);
        AddUser(Guid.NewGuid(), 6, active: false);

        var result = (await GetRecipients().Handle(new GetItemAlertRecipientsQuery(_milk), CancellationToken.None))!;

        result.SelectedUserIds.ShouldBeEmpty();
        result.Candidates.Select(c => c.UserId).ShouldBe([admin]);
        result.Candidates[0].Role.ShouldBe("Admin");
        result.DefaultDescription.ShouldContain("Stock Managers");
    }

    [Fact]
    public async Task SetRecipients_SavesThem_AuditsIt_AndEmptyGoesBackToTheDefault()
    {
        var ana = Guid.NewGuid();
        var ben = Guid.NewGuid();
        AddUser(ana, 1);
        AddUser(ben, 6);

        var saved = (await SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, [ana, ana]), CancellationToken.None))!;
        saved.SelectedUserIds.ShouldBe([ana]);
        await _audit.Received(1).LogAsync(AuditAction.ItemAlertRecipientsUpdated, AuditEntityType.Item, _milk.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _me, Arg.Any<CancellationToken>());

        var changed = (await SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, [ben]), CancellationToken.None))!;
        changed.SelectedUserIds.ShouldBe([ben]);

        var reset = (await SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, []), CancellationToken.None))!;
        reset.SelectedUserIds.ShouldBeEmpty();
        await using var db = TestDb.Create(_db);
        (await db.ItemAlertRecipients.CountAsync()).ShouldBe(2);
        (await db.ItemAlertRecipients.CountAsync(r => r.IsActive)).ShouldBe(0);
    }

    [Fact]
    public async Task SetRecipients_RefusesAnyoneWhoCannotReadStockNotifications()
    {
        var cashier = Guid.NewGuid();
        AddUser(cashier, 2);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, [cashier]), CancellationToken.None));

        ex.Message.ShouldContain("Stock Managers");
        await using var db = TestDb.Create(_db);
        (await db.ItemAlertRecipients.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task SetRecipients_ReActivatesARowThatWasRemoved()
    {
        var ana = Guid.NewGuid();
        AddUser(ana, 1);
        await SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, [ana]), CancellationToken.None);
        await SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, []), CancellationToken.None);

        var again = (await SetRecipients().Handle(new SetItemAlertRecipientsCommand(_milk, [ana]), CancellationToken.None))!;

        again.SelectedUserIds.ShouldBe([ana]);
        await using var db = TestDb.Create(_db);
        (await db.ItemAlertRecipients.CountAsync()).ShouldBe(1);
    }
}
