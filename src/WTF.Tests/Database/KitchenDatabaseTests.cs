using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using System.Reflection;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Kitchen;
using WTF.Api.Features.Kitchen.DTOs;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Kitchen;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class KitchenDatabaseTests
{
    private static readonly FixedTenant Shop = new(TenantDefaults.DefaultTenantId);

    private sealed record Setup(SqlTestDatabase Database, User Staff, Product Latte, Product Mocha, Product Brownie);

    private static async Task<Setup> SeedAsync(bool boardOn)
    {
        var database = await SqlTestDatabase.CreateAsync();
        var staff = await SqlSeed.UserAsync(database, "kitchen-cashier", roleId: 2);
        var latte = await SqlSeed.ProductAsync(database, staff.Id, "Latte", 150m);
        var mocha = await SqlSeed.ProductAsync(database, staff.Id, "Mocha", 170m);
        var brownie = await SqlSeed.ProductAsync(database, staff.Id, "Brownie", 90m);

        await using var db = database.CreateContext();
        db.TenantSettings.Add(new TenantSetting
        {
            TenantId = TenantDefaults.DefaultTenantId,
            ShopName = "Kape Barako",
            PrimaryColor = "#6f4e37",
            TimeZone = "Asia/Manila",
            CurrencySymbol = "P",
            CurrencyCode = "PHP",
            CurrencyDecimals = 2,
            KitchenBoardEnabled = boardOn
        });
        await db.SaveChangesAsync();
        return new Setup(database, staff, latte, mocha, brownie);
    }

    private static OrderItemRequestDto Line(Product product, int quantity = 1, string? note = null) =>
        new(product.Id, quantity, [], note, null);

    private static async Task<Guid> PlaceAsync(Setup s, OrderStatusEnum status, params OrderItemRequestDto[] lines)
    {
        await using var db = s.Database.CreateContext(Shop);
        var placed = await TestFakes.CreateOrderHandler(db, TestRequest.As(s.Staff.Id, AppRoles.Cashier))
            .Handle(new CreateOrderCommand { Items = [.. lines], Status = status }, CancellationToken.None);
        return placed.Id;
    }

    private static async Task EditAsync(Setup s, Guid id, OrderStatusEnum status, string? instructions, decimal? tips, params OrderItemRequestDto[] lines)
    {
        await using var db = s.Database.CreateContext(Shop);
        await TestFakes.UpdateOrderHandler(db, TestRequest.As(s.Staff.Id, AppRoles.Cashier))
            .Handle(new UpdateOrderCommand { Id = id, Items = [.. lines], Status = status, SpecialInstructions = instructions, Tips = tips }, CancellationToken.None);
    }

    private static async Task<KitchenOrderDto?> MoveAsync(
        Setup s, Guid id, KitchenState to, KitchenState? from = null, bool bringBack = false)
    {
        await using var db = s.Database.CreateContext(Shop);
        var sender = Substitute.For<ISender>();
        return await new MoveKitchenOrderHandler(
                db, TestRequest.As(s.Staff.Id, AppRoles.Kitchen), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Conversations(), sender)
            .Handle(new MoveKitchenOrderCommand(id, to, from, bringBack), CancellationToken.None);
    }

    private static async Task<KitchenBoardDto> BoardAsync(Setup s, string? states = null, string? search = null)
    {
        await using var db = s.Database.CreateContext(Shop);
        return await new GetKitchenBoardHandler(db).Handle(new GetKitchenBoardQuery(states, null, search), CancellationToken.None);
    }

    private static async Task<Order> LoadAsync(Setup s, Guid id)
    {
        await using var db = s.Database.CreateContext();
        return await db.Orders.AsNoTracking().SingleAsync(o => o.Id == id);
    }

    [SqlFact]
    public async Task NewOrders_AreTrackedOnlyWhileTheShopHasTheBoardOn()
    {
        var setupOn = await SeedAsync(boardOn: true);
        await using var onDatabase = setupOn.Database;
        var pending = await PlaceAsync(setupOn, OrderStatusEnum.Pending, Line(setupOn.Latte));
        var prepaid = await PlaceAsync(setupOn, OrderStatusEnum.Completed, Line(setupOn.Mocha));

        (await LoadAsync(setupOn, pending)).KitchenStatus.ShouldBe((byte)KitchenState.New);
        (await LoadAsync(setupOn, prepaid)).KitchenStatus.ShouldBe((byte)KitchenState.New);

        var off = await SeedAsync(boardOn: false);
        await using var offDatabase = off.Database;
        var untracked = await PlaceAsync(off, OrderStatusEnum.Pending, Line(off.Latte));

        (await LoadAsync(off, untracked)).KitchenStatus.ShouldBeNull();
        (await BoardAsync(off)).Orders.ShouldBeEmpty();
    }

    [SqlFact]
    public async Task TheBoard_ListsOldestFirst_HidesServed_AndShowsServedOnlyWhenAsked()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var first = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte, 2, "extra hot"));
        var second = await PlaceAsync(s, OrderStatusEnum.Completed, Line(s.Mocha));
        var third = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Brownie));
        await MoveAsync(s, third, KitchenState.Served);

        var board = await BoardAsync(s);

        board.Orders.Select(o => o.Id).ShouldBe([first, second]);
        board.Orders[0].Lines.Single().Note.ShouldBe("extra hot");
        board.Orders[0].Lines.Single().Quantity.ShouldBe(2);
        (await BoardAsync(s, states: "3")).Orders.Select(o => o.Id).ShouldBe([third]);
        (await BoardAsync(s, states: "0,1,2,3")).Orders.Count.ShouldBe(3);
    }

    [SqlFact]
    public async Task TheBoard_FindsAnOrderByItsNumber()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var first = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));
        await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Mocha));
        var number = (await LoadAsync(s, first)).OrderNumber;

        var found = await BoardAsync(s, search: $"#{number}");

        found.Orders.ShouldContain(o => o.Id == first);
    }

    [Fact]
    public void TheKitchenDto_NeverCarriesAPriceOrPaymentField()
    {
        var banned = new[] { "price", "total", "amount", "tip", "payment", "changeamount", "address", "phone", "contact", "note", "discount" };
        var names = new[] { typeof(KitchenOrderDto), typeof(KitchenLineDto), typeof(KitchenAddOnDto) }
            .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name.ToLowerInvariant()))
            .ToList();

        // The staff's order note is left out on purpose, and the line notes belong to the kitchen: only these names may contain "note".
        names.Where(n => banned.Any(n.Contains)).Except(["note", "changenote"]).ShouldBeEmpty();
    }

    [SqlFact]
    public async Task ReadyAndServed_FollowTheStepsAndNeverTouchPayment()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));

        (await MoveAsync(s, id, KitchenState.Preparing))!.KitchenStatus.ShouldBe((byte)KitchenState.Preparing);
        var ready = await MoveAsync(s, id, KitchenState.Ready);
        ready!.ReadyAt.ShouldNotBeNull();
        (await MoveAsync(s, id, KitchenState.Preparing))!.ReadyAt.ShouldBeNull();
        await MoveAsync(s, id, KitchenState.Served);

        var order = await LoadAsync(s, id);
        order.KitchenStatus.ShouldBe((byte)KitchenState.Served);
        order.KitchenServedAt.ShouldNotBeNull();
        order.KitchenUpdatedBy.ShouldBe(s.Staff.Id);
        order.StatusId.ShouldBe((int)OrderStatusEnum.Pending);
        (await BoardAsync(s)).Orders.ShouldBeEmpty();
    }

    [SqlFact]
    public async Task ATapOnAnOrderThatIsFurtherAlready_IsNotAnError_ButAWrongStepBackIs()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));
        await MoveAsync(s, id, KitchenState.Served);

        var again = await MoveAsync(s, id, KitchenState.Ready, from: KitchenState.Preparing);

        again!.KitchenStatus.ShouldBe((byte)KitchenState.Served);
        await Should.ThrowAsync<InvalidOperationException>(() => MoveAsync(s, id, KitchenState.Ready));
        (await MoveAsync(s, id, KitchenState.Ready, bringBack: true))!.KitchenStatus.ShouldBe((byte)KitchenState.Ready);
    }

    [SqlFact]
    public async Task AnOrderTheKitchenDoesNotTrack_CannotBeMoved()
    {
        var s = await SeedAsync(boardOn: false);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));

        await Should.ThrowAsync<InvalidOperationException>(() => MoveAsync(s, id, KitchenState.Preparing));
    }

    [SqlFact]
    public async Task AnotherShopsOrder_IsNotFound()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));

        await using var db = s.Database.CreateContext(new FixedTenant(Guid.NewGuid()));
        var result = await new MoveKitchenOrderHandler(
                db, TestRequest.As(s.Staff.Id, AppRoles.Kitchen), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Conversations(), Substitute.For<ISender>())
            .Handle(new MoveKitchenOrderCommand(id, KitchenState.Preparing), CancellationToken.None);

        result.ShouldBeNull();
    }

    [SqlFact]
    public async Task EditingOnlyThePaymentOrTips_RaisesNoTag()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte, 2));
        await MoveAsync(s, id, KitchenState.Ready);

        await EditAsync(s, id, OrderStatusEnum.Completed, "oat milk", 20m, Line(s.Latte, 2));

        var order = await LoadAsync(s, id);
        order.KitchenStatus.ShouldBe((byte)KitchenState.Ready);
        order.KitchenChangeKind.ShouldBeNull();
        order.KitchenChangeNote.ShouldBeNull();
    }

    [SqlFact]
    public async Task RemovingALineAfterReady_SendsItBackToPreparingWithAChangedTag()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte), Line(s.Mocha));
        await MoveAsync(s, id, KitchenState.Ready);

        await EditAsync(s, id, OrderStatusEnum.Pending, null, null, Line(s.Latte));

        var order = await LoadAsync(s, id);
        order.KitchenStatus.ShouldBe((byte)KitchenState.Preparing);
        order.ReadyAt.ShouldBeNull();
        order.KitchenChangeKind.ShouldBe((byte)KitchenChangeKind.Changed);
        order.KitchenChangeNote.ShouldBe("-1 Mocha");
    }

    [SqlFact]
    public async Task AddingALineToAServedOrder_BringsItBackAsNewWithAnAddedTag_UntilSeen()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var id = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));
        await MoveAsync(s, id, KitchenState.Served);

        await EditAsync(s, id, OrderStatusEnum.Pending, null, null, Line(s.Latte), Line(s.Brownie));

        var order = await LoadAsync(s, id);
        order.KitchenStatus.ShouldBe((byte)KitchenState.New);
        order.KitchenServedAt.ShouldBeNull();
        order.KitchenChangeKind.ShouldBe((byte)KitchenChangeKind.Added);
        order.KitchenChangeNote.ShouldBe("+1 Brownie");
        (await BoardAsync(s)).Orders.Single().ChangeNote.ShouldBe("+1 Brownie");

        await using var db = s.Database.CreateContext(Shop);
        var seen = await new MarkKitchenChangeSeenHandler(db, TestRequest.As(s.Staff.Id, AppRoles.Kitchen), TestFakes.Hub(), TestFakes.Conversations())
            .Handle(new MarkKitchenChangeSeenCommand(id), CancellationToken.None);
        seen!.ChangeNote.ShouldBeNull();
        seen.ChangeKind.ShouldBeNull();
    }

    [SqlFact]
    public async Task ACancelledOrder_VanishesWhileNew_AndStaysAsAStopCardOnceStarted_UntilDismissed()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var untouched = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));
        var started = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Mocha));
        await MoveAsync(s, started, KitchenState.Preparing);

        await EditAsync(s, untouched, OrderStatusEnum.Cancelled, null, null, Line(s.Latte));
        await EditAsync(s, started, OrderStatusEnum.Cancelled, null, null, Line(s.Mocha));

        var card = (await BoardAsync(s)).Orders.Single();
        card.Id.ShouldBe(started);
        card.IsStopMaking.ShouldBeTrue();

        await using var db = s.Database.CreateContext(Shop);
        await new DismissKitchenOrderHandler(db, TestRequest.As(s.Staff.Id, AppRoles.Kitchen), TestFakes.Hub(), TestFakes.Conversations())
            .Handle(new DismissKitchenOrderCommand(started), CancellationToken.None);

        (await BoardAsync(s)).Orders.ShouldBeEmpty();
        (await LoadAsync(s, started)).KitchenStatus.ShouldBe((byte)KitchenState.Preparing);
    }

    [SqlFact]
    public async Task OrdersFromEarlierDays_AreMarkedStale_AndClearOldServesOnlyThose()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var today = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));
        var yesterday = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Mocha));
        await using (var db = s.Database.CreateContext())
        {
            await db.Orders.Where(o => o.Id == yesterday)
                .ExecuteUpdateAsync(set => set.SetProperty(o => o.CreatedAt, DateTime.UtcNow.AddDays(-2)));
        }

        var board = await BoardAsync(s);
        board.Orders.Single(o => o.Id == yesterday).IsStale.ShouldBeTrue();
        board.Orders.Single(o => o.Id == today).IsStale.ShouldBeFalse();

        await using var clear = s.Database.CreateContext(Shop);
        var cleared = await new ClearOldKitchenOrdersHandler(
                clear, TestRequest.As(s.Staff.Id, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Conversations())
            .Handle(new ClearOldKitchenOrdersCommand(), CancellationToken.None);

        cleared.ShouldBe(1);
        (await LoadAsync(s, yesterday)).KitchenStatus.ShouldBe((byte)KitchenState.Served);
        (await LoadAsync(s, today)).KitchenStatus.ShouldBe((byte)KitchenState.New);
    }

    [SqlFact]
    public async Task TheKitchenFeature_NeedsTheShopsSwitchAsWellAsThePlan()
    {
        var off = await SeedAsync(boardOn: false);
        await using var offDatabase = off.Database;
        await using (var db = off.Database.CreateContext(Shop))
        {
            (await TenantPlanLookup.LoadAsync(db, TenantDefaults.DefaultTenantId, CancellationToken.None))
                .Features.ShouldNotContain(PlanFeatures.Kitchen);
        }

        var on = await SeedAsync(boardOn: true);
        await using var onDatabase = on.Database;
        await using var db2 = on.Database.CreateContext(Shop);
        (await TenantPlanLookup.LoadAsync(db2, TenantDefaults.DefaultTenantId, CancellationToken.None))
            .Features.ShouldContain(PlanFeatures.Kitchen);
    }

    [SqlFact]
    public async Task TheOrderList_CanBeFilteredByKitchenState()
    {
        var s = await SeedAsync(boardOn: true);
        await using var _ = s.Database;
        var open = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Latte));
        var served = await PlaceAsync(s, OrderStatusEnum.Pending, Line(s.Mocha));
        await MoveAsync(s, served, KitchenState.Served);

        await using var db = s.Database.CreateContext(Shop);
        var handler = new GetPagedOrdersHandler(db, TestFakes.Features);

        (await handler.Handle(new GetPagedOrdersQuery(Kitchen: "open"), default)).Items.Select(o => o.Id).ShouldBe([open]);
        var servedItems = (await handler.Handle(new GetPagedOrdersQuery(Kitchen: "served"), default)).Items;
        servedItems.Select(o => o.Id).ShouldBe([served]);
        servedItems[0].KitchenStatus.ShouldBe((byte)KitchenState.Served);
    }
}
