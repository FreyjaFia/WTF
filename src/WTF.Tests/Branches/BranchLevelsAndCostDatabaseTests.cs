using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchLevelsAndCostDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid Makati, Guid Cebu, Guid Milk, Guid Latte);

    // Oat milk: shop cost 0.02 per ml, warning 500 and critical 200. Makati holds 1000 ml, Cebu 900 ml. A latte takes 200 ml.
    private static async Task<Shop> OpenShopAsync()
    {
        var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using var db = database.CreateContext();
        var makati = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
        var cebu = SqlTestDatabase.MainBranch(Tenant, "CEB");
        cebu.IsMain = false;
        cebu.Name = "Cebu";
        db.Branches.Add(cebu);
        await db.SaveChangesAsync();

        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var milk = new Item
        {
            Id = Guid.NewGuid(),
            Name = "Oat Milk",
            UnitName = "milliliter",
            CostPrice = 0.02m,
            AverageCost = 0.02m,
            WarningQuantity = 500m,
            CriticalQuantity = 200m,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = user.Id
        };
        db.Items.Add(milk);
        db.ProductItemLinks.Add(new ProductItemLink
        {
            Id = Guid.NewGuid(),
            ProductId = latte.Id,
            ItemId = milk.Id,
            QuantityPerSale = 200m,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = user.Id
        });
        await db.SaveChangesAsync();
        db.ItemBranchStocks.RemoveRange(await db.ItemBranchStocks.ToListAsync());
        await db.SaveChangesAsync();
        db.ItemBranchStocks.AddRange(
            new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = milk.Id, BranchId = makati, CurrentQuantity = 1000m },
            new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = milk.Id, BranchId = cebu.Id, CurrentQuantity = 900m });
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, makati, cebu.Id, milk.Id, latte.Id);
    }

    private static WTFDbContext AsLimited(Shop shop, Guid branch) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([branch], branch, true));

    private static WTFDbContext AsAll(Shop shop, Guid? active = null) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], active, false));

    private static SaveItemBranchSettingsHandler Saver(WTFDbContext db, Shop shop) =>
        new(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Audit(), TestFakes.Alerts(db));

    private static async Task SellLatteAsync(Shop shop, Guid branch)
    {
        await using var db = AsLimited(shop, branch);
        var create = new CreateOrderHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);
        await create.Handle(new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(shop.Latte, 1, [], null, null)]
        }, CancellationToken.None);
    }

    [SqlFact]
    public async Task ASale_IsCostedAtTheBranchCost_WhenTheBranchSetOne_AndAtTheShopCostOtherwise()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsAll(shop))
        {
            await Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
                shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, null, null, null, 0.05m)], false), CancellationToken.None);
        }

        await SellLatteAsync(shop, shop.Cebu);
        await SellLatteAsync(shop, shop.Makati);

        await using var check = shop.Database.CreateContext();
        (await check.StockMovements.Where(m => m.BranchId == shop.Cebu && m.MovementType == "Sale").Select(m => m.UnitCost).SingleAsync()).ShouldBe(0.05m);
        (await check.StockMovements.Where(m => m.BranchId == shop.Makati && m.MovementType == "Sale").Select(m => m.UnitCost).SingleAsync()).ShouldBe(0.02m);
    }

    [SqlFact]
    public async Task ABranchLevel_ChangesTheStatusOfThatBranchOnly()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = AsAll(shop))
        {
            await Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
                shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, 1000m, 400m, null, null)], false), CancellationToken.None);
        }

        await using var read = AsAll(shop);
        var attention = await new GetStockAttentionHandler(read).Handle(new GetStockAttentionQuery(), CancellationToken.None);

        var rows = attention.Items.Where(i => i.Id == shop.Milk).ToList();
        rows.Count.ShouldBe(1);
        rows[0].BranchId.ShouldBe(shop.Cebu);
        rows[0].Status.ShouldBe("Warning");
        rows[0].WarningQuantity.ShouldBe(1000m);
    }

    [SqlFact]
    public async Task AnEmptyBranchValue_GoesBackToTheShopValue()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using var db = AsAll(shop);
        await Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
            shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, 100m, 50m, 700m, 0.05m)], false), CancellationToken.None);
        var cleared = await Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
            shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, null, null, null, null)], false), CancellationToken.None);

        var row = cleared!.Single(r => r.BranchId == shop.Cebu);
        row.WarningQuantity.ShouldBeNull();
        row.CriticalQuantity.ShouldBeNull();
        row.ParLevel.ShouldBeNull();
        row.CostPrice.ShouldBeNull();
        row.Status.ShouldBe("ok");
    }

    [SqlFact]
    public async Task ACashierLimitedToOneBranch_CannotChangeAnotherBranchSettings()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using var db = AsLimited(shop, shop.Makati);
        await Should.ThrowAsync<ForbiddenActionException>(() => Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
            shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, 10m, 5m, null, null)], false), CancellationToken.None));
    }

    [SqlFact]
    public async Task APersonWhoCannotReadCosts_KeepsTheBranchCostAsItWas()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using var db = AsAll(shop);
        await Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
            shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, null, null, null, 0.05m)], false), CancellationToken.None);
        var result = await Saver(db, shop).Handle(new SaveItemBranchSettingsCommand(
            shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, 400m, null, null, 9m)], true), CancellationToken.None);

        var row = result!.Single(r => r.BranchId == shop.Cebu);
        row.CostPrice.ShouldBe(0.05m);
        row.WarningQuantity.ShouldBe(400m);
    }
}
