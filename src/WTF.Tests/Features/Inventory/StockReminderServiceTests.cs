using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class StockReminderServiceTests
{
    private readonly string _db = TestDb.NewName();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly IReportFileStorage _reports = Substitute.For<IReportFileStorage>();
    private readonly Guid _admin;
    private readonly Guid _stockManager;
    private readonly Guid _viewer;
    private readonly Guid _milk;
    private byte[]? _state;

    public StockReminderServiceTests()
    {
        using (var db = TestDb.Create(_db))
        {
            db.UserRoles.AddRange(
                new UserRole { Id = 1, Name = AppRoles.Admin },
                new UserRole { Id = 3, Name = AppRoles.AdminViewer },
                new UserRole { Id = 6, Name = AppRoles.StockManager });
            db.SaveChanges();
        }

        _admin = AddUser(1);
        _stockManager = AddUser(6);
        _viewer = AddUser(3);
        _milk = StockSeed.Item(_db, "Oat Milk", 1000m, warning: 500m, critical: 200m);

        _reports.SaveAsync(Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<string>(), Arg.Any<DateTimeOffset?>(), Arg.Any<CancellationToken>())
            .Returns(ci =>
            {
                _state = (byte[])ci[1];
                return Task.CompletedTask;
            });
        _reports.ReadAllBytesAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(_ => Task.FromResult(_state));
    }

    private Guid AddUser(int roleId)
    {
        using var db = TestDb.Create(_db);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = $"u-{Guid.NewGuid():N}",
            PasswordHash = "x",
            FirstName = "A",
            LastName = "B",
            IsActive = true,
            RoleId = roleId
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    private StockReminderService Reminders(StockAlertRemindersOptions? options = null) =>
        new(TestDb.Create(_db), TestFakes.Notifications(TestDb.Create(_db), _push), _reports, Options.Create(options ?? new StockAlertRemindersOptions { DryRun = false }),
            NullLogger<StockReminderService>.Instance);

    private async Task Alert(decimal quantity, Guid? itemId = null)
    {
        await using (var db = TestDb.Create(_db))
        {
            var item = await db.Items.SingleAsync(i => i.Id == (itemId ?? _milk));
            item.CurrentQuantity = quantity;
            await db.SaveChangesAsync();
        }

        await new StockAlertService(TestDb.Create(_db), TestFakes.Notifications(TestDb.Create(_db), _push)).EvaluateAsync([itemId ?? _milk], CancellationToken.None);
    }

    private async Task Backdate(int days = 1)
    {
        await using var db = TestDb.Create(_db);
        foreach (var row in await db.Notifications.ToListAsync())
        {
            row.CreatedAt = row.CreatedAt.AddDays(-days);
            row.LastRemindedAt = row.LastRemindedAt?.AddDays(-days);
        }

        await db.SaveChangesAsync();
    }

    private async Task<List<Notification>> Rows()
    {
        await using var db = TestDb.Create(_db);
        return await db.Notifications.AsNoTracking().OrderBy(n => n.CreatedAt).ToListAsync();
    }

    private static int PushCount(IPushNotificationService push) =>
        push.ReceivedCalls().Count(call => call.GetMethodInfo().Name == nameof(IPushNotificationService.SendNotificationAsync));

    [Fact]
    public async Task TheNextDay_LiftsTheExistingAlertBackToTheTop_UnreadWithADayCount()
    {
        await Alert(400m);
        var before = await Rows();
        await Backdate();

        var result = await Reminders().RunAsync(CancellationToken.None);

        var rows = await Rows();
        rows.Count.ShouldBe(before.Count);
        rows.Select(r => r.Id).ToHashSet().ShouldBe(before.Select(r => r.Id).ToHashSet());
        rows.ShouldAllBe(r => r.ReminderCount == 1 && r.ReadAt == null && r.LastRemindedAt != null);
        rows[0].Title.ShouldBe("Still low: Oat Milk");
        rows[0].Body.ShouldBe("400 ml left. The warning level is 500 ml. Day 2.");
        result.Reminders.ShouldBe(before.Count);
        result.LowItems.ShouldBe(1);
    }

    [Fact]
    public async Task ARemindedAlert_ShowsTheNewLevelAndQuantity()
    {
        await Alert(400m);
        await Alert(150m);
        await Backdate();

        await Reminders().RunAsync(CancellationToken.None);

        var admin = (await Rows()).Last(r => r.UserId == _admin);
        admin.Severity.ShouldBe((byte)2);
        admin.Data!.ShouldContain("\"quantity\":150");
        admin.Title.ShouldBe("Still low: Oat Milk");
    }

    [Fact]
    public async Task RunningTwiceTheSameDay_RemindsOnce()
    {
        await Alert(400m);
        await Backdate();

        var first = await Reminders().RunAsync(CancellationToken.None);
        var second = await Reminders().RunAsync(CancellationToken.None);

        first.Reminders.ShouldBeGreaterThan(0);
        second.Reminders.ShouldBe(0);
        (await Rows()).ShouldAllBe(r => r.ReminderCount == 1);
    }

    [Fact]
    public async Task AnAlertMadeToday_IsNotRemindedToday()
    {
        await Alert(400m);

        var result = await Reminders().RunAsync(CancellationToken.None);

        result.Reminders.ShouldBe(0);
        (await Rows()).ShouldAllBe(r => r.ReminderCount == 0);
    }

    [Fact]
    public async Task ReadingTheAlert_DoesNotStopTheNextDaysReminder()
    {
        await Alert(400m);
        await using (var db = TestDb.Create(_db))
        {
            foreach (var row in await db.Notifications.ToListAsync())
            {
                row.ReadAt = DateTime.UtcNow;
            }

            await db.SaveChangesAsync();
        }

        await Backdate();

        await Reminders().RunAsync(CancellationToken.None);

        (await Rows()).ShouldAllBe(r => r.ReadAt == null);
    }

    [Fact]
    public async Task EachFurtherDay_CountsUp()
    {
        await Alert(400m);
        await Backdate();
        await Reminders().RunAsync(CancellationToken.None);
        await Backdate();

        await Reminders().RunAsync(CancellationToken.None);

        var rows = await Rows();
        rows.ShouldAllBe(r => r.ReminderCount == 2);
        rows[0].Body.ShouldEndWith("Day 3.");
    }

    [Fact]
    public async Task AnItemBackToOk_GetsNoReminder()
    {
        await Alert(400m);
        await Alert(900m);
        await Backdate();

        var result = await Reminders().RunAsync(CancellationToken.None);

        result.Reminders.ShouldBe(0);
        result.LowItems.ShouldBe(0);
        (await Rows()).ShouldAllBe(r => r.ReminderCount == 0);
    }

    [Fact]
    public async Task AnItemThatRecoveredAndFellAgain_RemindsOnlyTheNewAlert()
    {
        await Alert(400m);
        await Alert(900m);
        await Backdate();
        await Alert(400m);
        await Backdate();

        await Reminders().RunAsync(CancellationToken.None);

        var admin = (await Rows()).Where(r => r.UserId == _admin).OrderBy(r => r.CreatedAt).ToList();
        admin.Count.ShouldBe(2);
        admin.Count(r => r.ReminderCount == 1).ShouldBe(1);
        admin.Count(r => r.ReminderCount == 0).ShouldBe(1);
    }

    [Fact]
    public async Task NamedRecipients_AreTheOnlyOnesReminded()
    {
        await using (var db = TestDb.Create(_db))
        {
            db.ItemAlertRecipients.Add(new ItemAlertRecipient { ItemId = _milk, UserId = _viewer, IsActive = true, CreatedBy = _admin });
            await db.SaveChangesAsync();
        }

        await Alert(400m);
        await Backdate();

        await Reminders().RunAsync(CancellationToken.None);

        (await Rows()).Select(r => r.UserId).ShouldBe([_viewer]);
        (await Rows()).Single().ReminderCount.ShouldBe(1);
    }

    [Fact]
    public async Task TheReminderIsPushedToTheSamePeople()
    {
        await Alert(400m);
        await Backdate();
        _push.ClearReceivedCalls();

        await Reminders().RunAsync(CancellationToken.None);

        await _push.Received(1).SendNotificationAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 2 && ids.Contains(_admin) && ids.Contains(_stockManager)),
            "Still low: Oat Milk",
            "400 ml left. The warning level is 500 ml. Day 2.",
            $"/inventory/items/details/{_milk}",
            "StockAlert",
            _milk,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ADryRun_SendsAndChangesNothing()
    {
        await Alert(400m);
        await Backdate();
        _push.ClearReceivedCalls();

        var result = await Reminders(new StockAlertRemindersOptions { DryRun = true }).RunAsync(CancellationToken.None);

        result.DryRun.ShouldBeTrue();
        result.Reminders.ShouldBe(2);
        PushCount(_push).ShouldBe(0);
        (await Rows()).ShouldAllBe(r => r.ReminderCount == 0);
    }

    [Fact]
    public async Task WhenOff_DoesNothing()
    {
        await Alert(400m);
        await Backdate();

        var result = await Reminders(new StockAlertRemindersOptions { Enabled = false, DryRun = false }).RunAsync(CancellationToken.None);

        result.Skipped.ShouldBeTrue();
        (await Rows()).ShouldAllBe(r => r.ReminderCount == 0);
    }

    [Fact]
    public async Task AnInactiveItem_IsNotReminded()
    {
        await Alert(400m);
        await Backdate();
        await using (var db = TestDb.Create(_db))
        {
            (await db.Items.SingleAsync()).IsActive = false;
            await db.SaveChangesAsync();
        }

        var result = await Reminders().RunAsync(CancellationToken.None);

        result.Reminders.ShouldBe(0);
    }

    [Fact]
    public async Task AnItemThatWasNeverAlerted_StaysQuiet()
    {
        StockSeed.Item(_db, "Fresh item", 0m, warning: 5m);

        var result = await Reminders().RunAsync(CancellationToken.None);

        result.Reminders.ShouldBe(0);
        (await Rows()).ShouldBeEmpty();
    }

    [Fact]
    public async Task AnItemAlreadyLowBeforeAnyAlertWasSaved_GetsAFirstRow()
    {
        await using (var db = TestDb.Create(_db))
        {
            var item = await db.Items.SingleAsync();
            item.CurrentQuantity = 400m;
            item.LastAlertStatus = 1;
            await db.SaveChangesAsync();
        }

        var result = await Reminders().RunAsync(CancellationToken.None);

        result.Reminders.ShouldBe(2);
        var rows = await Rows();
        rows.Select(r => r.UserId).ToHashSet().ShouldBe([_admin, _stockManager], ignoreOrder: true);
        rows[0].Title.ShouldBe("Low stock: Oat Milk");
    }

    [Fact]
    public async Task AFailedPush_DoesNotStopTheRemindersBeingSaved()
    {
        await Alert(400m);
        await Backdate();
        _push.SendNotificationAsync(default!, default!, default!, default, default!, default, default).ThrowsAsyncForAnyArgs(new InvalidOperationException("boom"));

        await Should.NotThrowAsync(() => Reminders().RunAsync(CancellationToken.None));

        (await Rows()).ShouldAllBe(r => r.ReminderCount == 1);
    }

    [Fact]
    public async Task TheLastRun_IsSavedAndReadBack()
    {
        var result = await Reminders().RunAsync(CancellationToken.None);

        var last = await Reminders().GetLastRunAsync(CancellationToken.None);

        last.ShouldNotBeNull();
        last!.RanAtUtc.ShouldBe(result.RanAtUtc);
    }

    [Fact]
    public async Task TheLastRun_IsNullBeforeTheFirstRun()
    {
        (await Reminders().GetLastRunAsync(CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public void TheDefaults_AreEightInTheMorningInManilaWithADryRun()
    {
        var options = new StockAlertRemindersOptions();

        StockAlertRemindersOptions.SectionName.ShouldBe("StockAlertReminders");
        options.RunAtHour.ShouldBe(8);
        options.TimeZoneId.ShouldBe("Asia/Manila");
        options.DryRun.ShouldBeTrue();
    }
}
