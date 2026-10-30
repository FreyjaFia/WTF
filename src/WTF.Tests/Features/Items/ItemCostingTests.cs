using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class ItemCostingTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    private AddItemStockHandler AddStock() =>
        new(TestDb.Create(_db), TestRequest.As(_userId), _audit, TestFakes.Alerts(TestDb.Create(_db)));

    private UpdateItemHandler Update() =>
        new(TestDb.Create(_db), TestRequest.As(_userId), _audit, TestFakes.Alerts(TestDb.Create(_db)));

    private CreateItemHandler Create() =>
        new(TestDb.Create(_db), TestRequest.As(_userId), _audit, TestFakes.Alerts(TestDb.Create(_db)));

    [Fact]
    public async Task StockIn_WithACost_BlendsTheAverageWithWhatIsOnHand()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 1000, cost: 0.15m);
        await using (var seed = TestDb.Create(_db))
        {
            (await seed.Items.SingleAsync()).AverageCost = 0.15m;
            await seed.SaveChangesAsync();
        }

        var dto = await AddStock().Handle(
            new AddItemStockCommand { ItemId = item.Id, Quantity = 1000, UnitCost = 0.20m }, CancellationToken.None);

        dto!.AverageCost.ShouldBe(0.175m);
        dto.CostPrice.ShouldBe(0.20m);
        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).AverageCost.ShouldBe(0.175m);
        (await db.StockMovements.SingleAsync()).UnitCost.ShouldBe(0.20m);
    }

    [Fact]
    public async Task StockIn_WithoutACost_KeepsTheAverage()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 100, cost: 2m);
        await using (var seed = TestDb.Create(_db))
        {
            (await seed.Items.SingleAsync()).AverageCost = 2m;
            await seed.SaveChangesAsync();
        }

        await AddStock().Handle(new AddItemStockCommand { ItemId = item.Id, Quantity = 50 }, CancellationToken.None);

        await using var db = TestDb.Create(_db);
        (await db.Items.SingleAsync()).AverageCost.ShouldBe(2m);
    }

    [Fact]
    public async Task StockIn_IntoAnEmptyItem_StartsTheAverageFromTheDelivery()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 0);

        var dto = await AddStock().Handle(
            new AddItemStockCommand { ItemId = item.Id, Quantity = 10, UnitCost = 3.5m }, CancellationToken.None);

        dto!.AverageCost.ShouldBe(3.5m);
    }

    [Fact]
    public async Task Create_WithACost_StartsTheAverageAtThatCost()
    {
        await ItemSeed.User(_db, _userId);

        var dto = await Create().Handle(
            new CreateItemCommand { Name = "Milk", UnitName = "ml", CostPrice = 0.15m, YieldPercent = 80 }, CancellationToken.None);

        dto.AverageCost.ShouldBe(0.15m);
        dto.YieldPercent.ShouldBe(80m);
        dto.UsableCost.ShouldBe(0.1875m);
    }

    [Fact]
    public async Task Create_ByARoleThatCannotSeeCosts_SavesNoCost()
    {
        await ItemSeed.User(_db, _userId);

        var dto = await Create().Handle(
            new CreateItemCommand { Name = "Milk", UnitName = "ml", CostPrice = 0.15m, YieldPercent = 50, KeepCosts = true },
            CancellationToken.None);

        dto.CostPrice.ShouldBeNull();
        dto.AverageCost.ShouldBeNull();
        dto.YieldPercent.ShouldBe(100m);
    }

    [Fact]
    public async Task Update_ChangingTheCost_RestartsTheAverage()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10, cost: 4m);
        await using (var seed = TestDb.Create(_db))
        {
            (await seed.Items.SingleAsync()).AverageCost = 4.5m;
            await seed.SaveChangesAsync();
        }

        var dto = await Update().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", CostPrice = 6m, YieldPercent = 90 },
            CancellationToken.None);

        dto!.CostPrice.ShouldBe(6m);
        dto.AverageCost.ShouldBe(6m);
        dto.YieldPercent.ShouldBe(90m);
    }

    [Fact]
    public async Task Update_SameCost_KeepsTheAverage()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10, cost: 4m);
        await using (var seed = TestDb.Create(_db))
        {
            (await seed.Items.SingleAsync()).AverageCost = 4.5m;
            await seed.SaveChangesAsync();
        }

        var dto = await Update().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Flour", UnitName = "kg", CostPrice = 4m },
            CancellationToken.None);

        dto!.AverageCost.ShouldBe(4.5m);
    }

    [Fact]
    public async Task Update_ByARoleThatCannotSeeCosts_LeavesCostAndYieldAlone()
    {
        await ItemSeed.User(_db, _userId);
        var item = await ItemSeed.Item(_db, _userId, qty: 10, cost: 4m);
        await using (var seed = TestDb.Create(_db))
        {
            var row = await seed.Items.SingleAsync();
            row.AverageCost = 4.5m;
            row.YieldPercent = 80m;
            await seed.SaveChangesAsync();
        }

        await Update().Handle(
            new UpdateItemCommand { Id = item.Id, Name = "Flour 2", UnitName = "kg", KeepCosts = true },
            CancellationToken.None);

        await using var db = TestDb.Create(_db);
        var saved = await db.Items.SingleAsync();
        saved.Name.ShouldBe("Flour 2");
        saved.CostPrice.ShouldBe(4m);
        saved.AverageCost.ShouldBe(4.5m);
        saved.YieldPercent.ShouldBe(80m);
        (await db.ItemPriceHistories.CountAsync()).ShouldBe(0);
    }

    [Theory]
    [InlineData(AppRoles.SuperAdmin, true)]
    [InlineData(AppRoles.Admin, true)]
    [InlineData(AppRoles.AdminViewer, true)]
    [InlineData(AppRoles.StockManager, false)]
    [InlineData(AppRoles.ItemManager, false)]
    [InlineData(AppRoles.Cashier, false)]
    public void CanReadCosts_FollowsTheRole(string role, bool expected)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));

        CostAccess.CanReadCosts(user).ShouldBe(expected);
    }

    [Fact]
    public void ForUser_HidesEveryCostForARoleThatCannotSeeCosts()
    {
        var movement = new StockMovementDto(
            Guid.NewGuid(), Guid.NewGuid(), "AddStock", 5, 0, 5, 0.2m, null, null, null, DateTime.UtcNow, Guid.NewGuid(), "Una");
        var item = new ItemDto(
            Guid.NewGuid(), "Milk", null, null, "ml", null, null, 5, 0.2m, null, null, true, true, null,
            DateTime.UtcNow, Guid.NewGuid(), null, null,
            [new ItemPriceHistoryDto(Guid.NewGuid(), Guid.NewGuid(), 0.1m, 0.2m, DateTime.UtcNow, Guid.NewGuid(), "Una")],
            [],
            [movement],
            0.18m, 80m, 0.225m);
        var stockManager = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.StockManager)], "test"));
        var admin = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.Admin)], "test"));

        var hidden = CostAccess.ForUser(item, stockManager);

        hidden.CostPrice.ShouldBeNull();
        hidden.AverageCost.ShouldBeNull();
        hidden.UsableCost.ShouldBeNull();
        hidden.PriceHistory.ShouldBeEmpty();
        hidden.RecentMovements.Single().UnitCost.ShouldBeNull();
        hidden.CurrentQuantity.ShouldBe(5m);
        CostAccess.ForUser(item, admin).ShouldBeSameAs(item);
    }

    [Fact]
    public void ForUser_HidesMovementCostsOnAPage()
    {
        var movement = new StockMovementDto(
            Guid.NewGuid(), Guid.NewGuid(), "Sale", -1, 5, 4, 0.2m, null, null, null, DateTime.UtcNow, Guid.NewGuid(), "Una");
        var page = new PagedStockMovementsDto([movement], 1);
        var cashier = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.Cashier)], "test"));

        CostAccess.ForUser(page, cashier).Items.Single().UnitCost.ShouldBeNull();
    }
}
