using Microsoft.EntityFrameworkCore;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class StockAlertServiceTests
{
    private readonly string _db = TestDb.NewName();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly Guid _superAdmin;
    private readonly Guid _admin;
    private readonly Guid _stockManager;
    private readonly Guid _cashier;
    private readonly Guid _viewer;
    private readonly Guid _inactiveAdmin;
    private readonly Guid _milk;

    public StockAlertServiceTests()
    {
        using (var db = TestDb.Create(_db))
        {
            db.UserRoles.AddRange(
                new UserRole { Id = 1, Name = AppRoles.Admin },
                new UserRole { Id = 2, Name = AppRoles.Cashier },
                new UserRole { Id = 3, Name = AppRoles.AdminViewer },
                new UserRole { Id = 4, Name = AppRoles.SuperAdmin },
                new UserRole { Id = 6, Name = AppRoles.StockManager });
            db.SaveChanges();
        }

        _superAdmin = AddUser(4);
        _admin = AddUser(1);
        _stockManager = AddUser(6);
        _cashier = AddUser(2);
        _viewer = AddUser(3);
        _inactiveAdmin = AddUser(1, active: false);
        _milk = StockSeed.Item(_db, "Oat Milk", 1000m, warning: 500m, critical: 200m);
    }

    private Guid AddUser(int roleId, bool active = true)
    {
        using var db = TestDb.Create(_db);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = $"u-{Guid.NewGuid():N}",
            PasswordHash = "x",
            FirstName = "A",
            LastName = "B",
            IsActive = active,
            RoleId = roleId
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    private StockAlertService Service() => new(TestDb.Create(_db), TestFakes.Notifications(TestDb.Create(_db), _push));

    private async Task SetQuantityAndEvaluate(decimal quantity, Guid? itemId = null)
    {
        await using (var db = TestDb.Create(_db))
        {
            var item = await db.Items.SingleAsync(i => i.Id == (itemId ?? _milk));
            item.CurrentQuantity = quantity;
            await db.SaveChangesAsync();
        }

        await Service().EvaluateAsync([itemId ?? _milk], CancellationToken.None);
    }

    private async Task<List<Notification>> Notifications()
    {
        await using var db = TestDb.Create(_db);
        return await db.Notifications.AsNoTracking().OrderBy(n => n.CreatedAt).ToListAsync();
    }

    private static int PushCount(IPushNotificationService push) =>
        push.ReceivedCalls().Count(call => call.GetMethodInfo().Name == nameof(IPushNotificationService.SendNotificationAsync));

    [Fact]
    public async Task FallingToTheWarningLevel_TellsTheStockRolesAndNobodyElse()
    {
        await SetQuantityAndEvaluate(400m);

        var rows = await Notifications();
        rows.Select(n => n.UserId).ToHashSet().ShouldBe([_superAdmin, _admin, _stockManager], ignoreOrder: true);
        rows.ShouldAllBe(n => n.Severity == 1 && n.Data!.Contains("\"quantity\":400") && n.ReadAt == null);
        rows[0].Title.ShouldBe("Low stock: Oat Milk");
        rows[0].Body.ShouldBe("400 ml left. The warning level is 500 ml.");
        await _push.Received(1).SendNotificationAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 3 && !ids.Contains(_cashier) && !ids.Contains(_viewer) && !ids.Contains(_inactiveAdmin)),
            "Low stock: Oat Milk",
            "400 ml left. The warning level is 500 ml.",
            $"/inventory/items/details/{_milk}",
            "StockAlert",
            _milk,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StayingAtTheSameLevel_DoesNotAlertAgain()
    {
        await SetQuantityAndEvaluate(400m);
        await SetQuantityAndEvaluate(350m);

        (await Notifications()).Count.ShouldBe(3);
        PushCount(_push).ShouldBe(1);
    }

    [Fact]
    public async Task GettingWorse_AlertsOncePerLevel_WithTheRightWords()
    {
        await SetQuantityAndEvaluate(400m);
        await SetQuantityAndEvaluate(150m);
        await SetQuantityAndEvaluate(0m);
        await SetQuantityAndEvaluate(-50m);

        var titles = (await Notifications()).Where(n => n.UserId == _admin).Select(n => n.Title).ToList();
        titles.ShouldBe(["Low stock: Oat Milk", "Critically low: Oat Milk", "Out of stock: Oat Milk"]);
    }

    [Fact]
    public async Task AnItemThatStartsBelowZero_SaysSo()
    {
        await SetQuantityAndEvaluate(-50m);

        var row = (await Notifications()).First(n => n.UserId == _admin);
        row.Title.ShouldBe("Below zero: Oat Milk");
        row.Body.ShouldBe("-50 ml. Count it and correct the stock.");
    }

    [Fact]
    public async Task BackToOk_ThenFallingAgain_AlertsAgain()
    {
        await SetQuantityAndEvaluate(400m);
        await SetQuantityAndEvaluate(900m);
        await SetQuantityAndEvaluate(400m);

        (await Notifications()).Count(n => n.UserId == _admin).ShouldBe(2);
    }

    [Fact]
    public async Task PartialRecovery_ThenFallingToCriticalAgain_AlertsAgain()
    {
        await SetQuantityAndEvaluate(150m);
        await SetQuantityAndEvaluate(400m);
        await SetQuantityAndEvaluate(150m);

        (await Notifications()).Count(n => n.UserId == _admin && n.Severity == 2).ShouldBe(2);
    }

    [Fact]
    public async Task AnItemThatIsFine_SendsNothing()
    {
        await SetQuantityAndEvaluate(900m);

        (await Notifications()).ShouldBeEmpty();
        PushCount(_push).ShouldBe(0);
    }

    [Fact]
    public async Task NamedRecipients_ReplaceTheDefaultRoles()
    {
        await using (var db = TestDb.Create(_db))
        {
            db.ItemAlertRecipients.AddRange(
                new ItemAlertRecipient { ItemId = _milk, UserId = _viewer, IsActive = true, CreatedBy = _admin },
                new ItemAlertRecipient { ItemId = _milk, UserId = _admin, IsActive = false, CreatedBy = _admin });
            await db.SaveChangesAsync();
        }

        await SetQuantityAndEvaluate(400m);

        (await Notifications()).Select(n => n.UserId).ShouldBe([_viewer]);
    }

    [Fact]
    public async Task ARecipientWhoWasDeactivated_FallsBackToTheDefaultRoles()
    {
        await using (var db = TestDb.Create(_db))
        {
            db.ItemAlertRecipients.Add(new ItemAlertRecipient { ItemId = _milk, UserId = _inactiveAdmin, IsActive = true, CreatedBy = _admin });
            await db.SaveChangesAsync();
        }

        await SetQuantityAndEvaluate(400m);

        (await Notifications()).Select(n => n.UserId).ToHashSet().ShouldBe([_superAdmin, _admin, _stockManager], ignoreOrder: true);
    }

    [Fact]
    public async Task APushThatFails_DoesNotStopTheAlertBeingSaved()
    {
        _push.SendNotificationAsync(default!, default!, default!, default, default!, default, default).ThrowsAsyncForAnyArgs(new InvalidOperationException("boom"));

        await Should.NotThrowAsync(() => SetQuantityAndEvaluate(400m));

        (await Notifications()).Count.ShouldBe(3);
    }

    [Fact]
    public async Task InactiveItems_AreNotAlerted()
    {
        var old = StockSeed.Item(_db, "Old syrup", 1m, active: false, warning: 5m);

        await SetQuantityAndEvaluate(1m, old);

        (await Notifications()).ShouldBeEmpty();
    }

    [Fact]
    public async Task OrderDeductionThatCrossesTheLevel_Alerts()
    {
        var data = new WTF.Tests.Features.Orders.OrderSeed(_db);
        var latte = data.AddProduct("Latte", 150m);
        StockSeed.Link(_db, latte, _milk, 200m);
        var order = data.AddOrder(WTF.Api.Features.Orders.Enums.OrderStatusEnum.Completed);
        data.AddLine(order, latte, 4);
        var stock = new OrderStockService(TestDb.Create(_db), TestFakes.Audit(), new StockAlertService(TestDb.Create(_db), TestFakes.Notifications(TestDb.Create(_db), _push)));

        await stock.DeductForOrderAsync(order, _admin, new StockDeductionOptions(), CancellationToken.None);

        // 1000 - 800 = 200, which is the critical level.
        (await Notifications()).Where(n => n.UserId == _admin).Select(n => n.Title).ShouldBe(["Critically low: Oat Milk"]);
    }
    [Fact]
    public async Task AStockAdjustmentThatLowersTheBalance_Alerts()
    {
        var handler = new AdjustItemStockHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(new AdjustItemStockCommand { ItemId = _milk, QuantityChange = -600m, Reason = "Lost" }, CancellationToken.None);

        (await Notifications()).Where(n => n.UserId == _admin).Select(n => n.Title).ShouldBe(["Low stock: Oat Milk"]);
    }

    [Fact]
    public async Task RaisingTheWarningLevelAboveTheBalance_Alerts()
    {
        var handler = new WTF.Api.Features.Items.UpdateItemHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(
            new WTF.Api.Features.Items.UpdateItemCommand { Id = _milk, Name = "Oat Milk", UnitName = "ml", WarningQuantity = 1500m, CriticalQuantity = 200m },
            CancellationToken.None);

        (await Notifications()).Where(n => n.UserId == _admin).Select(n => n.Title).ShouldBe(["Low stock: Oat Milk"]);
    }

    [Fact]
    public async Task CreatingAnItemWhoseStartingStockIsAlreadyLow_Alerts()
    {
        var handler = new WTF.Api.Features.Items.CreateItemHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(
            new WTF.Api.Features.Items.CreateItemCommand { Name = "Cups", UnitName = "piece", StartingQuantity = 40m, WarningQuantity = 50m, CriticalQuantity = 10m },
            CancellationToken.None);

        (await Notifications()).Where(n => n.UserId == _admin).Select(n => n.Title).ShouldBe(["Low stock: Cups"]);
    }

    [Fact]
    public async Task CreatingAnItemWithNothingYet_DoesNotAlert()
    {
        var handler = new WTF.Api.Features.Items.CreateItemHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(new WTF.Api.Features.Items.CreateItemCommand { Name = "Lids", UnitName = "piece", WarningQuantity = 50m }, CancellationToken.None);

        (await Notifications()).ShouldBeEmpty();
    }

    [Fact]
    public async Task CreatingAnItemThatIsFine_DoesNotAlert()
    {
        var handler = new WTF.Api.Features.Items.CreateItemHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(
            new WTF.Api.Features.Items.CreateItemCommand { Name = "Cups", UnitName = "piece", StartingQuantity = 500m, WarningQuantity = 50m },
            CancellationToken.None);

        (await Notifications()).ShouldBeEmpty();
    }

    [Fact]
    public async Task RestoringAnItemThatFellWhileInactive_Alerts()
    {
        var item = StockSeed.Item(_db, "Old syrup", 3m, active: false, warning: 5m);
        var handler = new WTF.Api.Features.Items.RestoreItemHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(new WTF.Api.Features.Items.RestoreItemCommand(item), CancellationToken.None);

        (await Notifications()).Where(n => n.UserId == _admin).Select(n => n.Title).ShouldBe(["Low stock: Old syrup"]);
    }

    [Fact]
    public async Task RestoringAnItemThatIsFine_DoesNotAlert()
    {
        var item = StockSeed.Item(_db, "Old syrup", 30m, active: false, warning: 5m);
        var handler = new WTF.Api.Features.Items.RestoreItemHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());

        await handler.Handle(new WTF.Api.Features.Items.RestoreItemCommand(item), CancellationToken.None);

        (await Notifications()).ShouldBeEmpty();
    }

    [Fact]
    public async Task AStockInThatBringsTheItemBackToOk_LetsItAlertAgainLater()
    {
        await SetQuantityAndEvaluate(400m);
        var addStock = new WTF.Api.Features.Items.AddItemStockHandler(TestDb.Create(_db), TestRequest.As(_admin), TestFakes.Audit(), Service());
        await addStock.Handle(new WTF.Api.Features.Items.AddItemStockCommand { ItemId = _milk, Quantity = 2000m }, CancellationToken.None);

        await SetQuantityAndEvaluate(300m);

        (await Notifications()).Count(n => n.UserId == _admin).ShouldBe(2);
    }
}
