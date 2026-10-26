using Microsoft.EntityFrameworkCore;
using NSubstitute;
using System.Text.Json;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class ItemAlertRecipientsHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _admin;
    private readonly Guid _stockManager;
    private readonly Guid _viewer;
    private readonly Guid _cashier;
    private readonly Guid _inactiveAdmin;
    private readonly Guid _item;

    public ItemAlertRecipientsHandlerTests()
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

        _admin = AddUser(1, "Ann");
        _stockManager = AddUser(6, "Bob");
        _viewer = AddUser(3, "Cy");
        _cashier = AddUser(2, "Di");
        _inactiveAdmin = AddUser(1, "Ed", active: false);
        _item = StockSeed.Item(_db, "Oat Milk", 100m);
    }

    private Guid AddUser(int roleId, string firstName, bool active = true)
    {
        using var db = TestDb.Create(_db);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = $"u-{Guid.NewGuid():N}",
            PasswordHash = "x",
            FirstName = firstName,
            LastName = "Tester",
            IsActive = active,
            RoleId = roleId
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    private SetItemAlertRecipientsHandler Setter() => new(TestDb.Create(_db), TestRequest.As(_admin, AppRoles.Admin), _audit);

    private Task<WTF.Api.Features.Inventory.DTOs.ItemAlertRecipientsDto?> Set(params Guid[] userIds) =>
        Setter().Handle(new SetItemAlertRecipientsCommand(_item, [.. userIds]), CancellationToken.None);

    [Fact]
    public async Task Get_UnknownItem_ReturnsNull() =>
        (await new GetItemAlertRecipientsHandler(TestDb.Create(_db)).Handle(new GetItemAlertRecipientsQuery(Guid.NewGuid()), CancellationToken.None))
            .ShouldBeNull();

    [Fact]
    public async Task Get_OffersOnlyActivePeopleWhoCanReadStockAlerts_AndNamesTheDefault()
    {
        var result = (await new GetItemAlertRecipientsHandler(TestDb.Create(_db))
            .Handle(new GetItemAlertRecipientsQuery(_item), CancellationToken.None))!;

        result.SelectedUserIds.ShouldBeEmpty();
        result.Candidates.Select(c => c.UserId).ShouldBe([_admin, _stockManager, _viewer], ignoreOrder: true);
        result.DefaultDescription.ShouldBe("Super Admins, Admins and Stock Managers");
    }

    [Fact]
    public async Task Set_UnknownItem_ReturnsNullAndAuditsNothing()
    {
        var result = await Setter().Handle(new SetItemAlertRecipientsCommand(Guid.NewGuid(), [_admin]), CancellationToken.None);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Set_NamedPeople_AreSavedAndAudited()
    {
        var result = (await Set(_stockManager, _viewer))!;

        result.SelectedUserIds.ShouldBe([_stockManager, _viewer], ignoreOrder: true);
        await _audit.Received(1).LogAsync(AuditAction.ItemAlertRecipientsUpdated, AuditEntityType.Item, _item.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _admin, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("cashier")]
    [InlineData("inactive")]
    [InlineData("unknown")]
    public async Task Set_SomeoneWhoCannotReceiveStockAlerts_IsRefused(string who)
    {
        var person = who switch
        {
            "cashier" => _cashier,
            "inactive" => _inactiveAdmin,
            _ => Guid.NewGuid()
        };

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Set(_admin, person));

        ex.Message.ShouldContain("Only active Super Admins, Admins, Admin Viewers and Stock Managers");
        await using var db = TestDb.Create(_db);
        (await db.ItemAlertRecipients.CountAsync()).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Set_ReplacingTheList_SwitchesOffTheRemovedAndBringsBackAnEarlierOne()
    {
        await Set(_admin, _stockManager);
        await Set(_stockManager);
        var result = (await Set(_admin))!;

        result.SelectedUserIds.ShouldBe([_admin]);
        await using var db = TestDb.Create(_db);
        var rows = await db.ItemAlertRecipients.Where(r => r.ItemId == _item).ToListAsync();
        rows.Count.ShouldBe(2); // rows are kept, only switched on and off
        rows.Single(r => r.UserId == _admin).IsActive.ShouldBeTrue();
        rows.Single(r => r.UserId == _stockManager).IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Set_EmptyList_GoesBackToTheDefaultRoles()
    {
        await Set(_admin);
        var result = (await Set())!;

        result.SelectedUserIds.ShouldBeEmpty();
        (await StockAlertService.ResolveRecipientsAsync(TestDb.Create(_db), _item, CancellationToken.None)).ShouldContain(_stockManager);
    }

    [Fact]
    public async Task Set_AuditCarriesTheOldAndNewLists()
    {
        await Set(_admin);
        _audit.ClearReceivedCalls();

        await Set(_stockManager);

        await _audit.Received(1).LogAsync(AuditAction.ItemAlertRecipientsUpdated, AuditEntityType.Item, _item.ToString(),
            Arg.Is<object?>(old => old != null && JsonSerializer.Serialize(old, (JsonSerializerOptions?)null).Contains(_admin.ToString())),
            Arg.Is<object?>(now => now != null && JsonSerializer.Serialize(now, (JsonSerializerOptions?)null).Contains(_stockManager.ToString())),
            _admin, Arg.Any<CancellationToken>());
    }
}
