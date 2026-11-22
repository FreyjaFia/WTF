using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Endpoints;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Items;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchGuardsDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid Makati, Guid Cebu, Guid Milk);

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
        var milk = new Item
        {
            Id = Guid.NewGuid(),
            Name = "Oat Milk",
            UnitName = "milliliter",
            CostPrice = 0.02m,
            AverageCost = 0.02m,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = user.Id
        };
        db.Items.Add(milk);
        await db.SaveChangesAsync();
        db.ItemBranchStocks.RemoveRange(await db.ItemBranchStocks.ToListAsync());
        await db.SaveChangesAsync();
        db.ItemBranchStocks.AddRange(
            new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = milk.Id, BranchId = makati, CurrentQuantity = 0m },
            new ItemBranchStock { Id = Guid.NewGuid(), TenantId = Tenant, ItemId = milk.Id, BranchId = cebu.Id, CurrentQuantity = 0m });
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, makati, cebu.Id, milk.Id);
    }

    private static CurrentBranch Limited(params Guid[] ids)
    {
        var current = new CurrentBranch();
        current.Resolve(ids, true, ids[0], false);
        return current;
    }

    private static CurrentBranch Everywhere(params Guid[] ids)
    {
        var current = new CurrentBranch();
        current.Resolve(ids, false, ids[0], false);
        return current;
    }

    [SqlFact]
    public async Task ALimitedPerson_CannotAddReopenOrMakeMainABranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var limited = Limited(shop.Cebu);
        var scope = new BranchScopeCache(TimeProvider.System);
        var accessor = TestRequest.As(shop.UserId, AppRoles.Admin);

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant), limited);

        await Should.ThrowAsync<ForbiddenActionException>(() =>
            new CreateBranchHandler(db, accessor, TestFakes.Audit(), new FixedTenant(Tenant), limited, scope).Handle(new CreateBranchCommand("Davao", "DVO", null, null), CancellationToken.None));
        await Should.ThrowAsync<ForbiddenActionException>(() =>
            new MakeMainBranchHandler(db, accessor, TestFakes.Audit(), limited, scope).Handle(new MakeMainBranchCommand(shop.Cebu), CancellationToken.None));
        await Should.ThrowAsync<ForbiddenActionException>(() =>
            new ReopenBranchHandler(db, accessor, TestFakes.Audit(), new FixedTenant(Tenant), limited, scope).Handle(new ReopenBranchCommand(shop.Cebu), CancellationToken.None));
    }

    [SqlFact]
    public async Task TheCloseCheck_CountsAHeldOrderOnce_AndStockBelowZeroOrOfAnInactiveItemStillBlocks()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var seed = shop.Database.CreateContext())
        {
            seed.Orders.Add(new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.PendingReview, CreatedAt = DateTime.UtcNow, CreatedBy = shop.UserId, BranchId = shop.Cebu });
            (await seed.Items.SingleAsync(i => i.Id == shop.Milk)).IsActive = false;
            (await seed.ItemBranchStocks.SingleAsync(s => s.ItemId == shop.Milk && s.BranchId == shop.Cebu)).CurrentQuantity = -5m;
            await seed.SaveChangesAsync();
        }

        var all = Everywhere(shop.Makati, shop.Cebu);
        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant), all);

        var check = await new GetBranchCloseCheckHandler(db, all).Handle(new GetBranchCloseCheckQuery(shop.Cebu), CancellationToken.None);

        check!.OpenOrders.ShouldBe(0);
        check.HeldOrders.ShouldBe(1);
        check.ItemsWithStock.ShouldBe(1);
        check.CanClose.ShouldBeFalse();
    }

    [SqlFact]
    public async Task ItemBranchSettings_RefuseAClosedBranch_AndKeepTheCostWithoutTheCostsKey()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var everywhere = Everywhere(shop.Makati, shop.Cebu);

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant), everywhere))
        {
            var cashier = new SaveItemBranchSettingsHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier, "UTC"), TestFakes.Audit(), TestFakes.Alerts(db));
            await cashier.Handle(new SaveItemBranchSettingsCommand(shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, 100m, null, null, 9m)], false), CancellationToken.None);
        }

        await using (var check = shop.Database.CreateContext())
        {
            var row = await check.ItemBranchStocks.SingleAsync(s => s.ItemId == shop.Milk && s.BranchId == shop.Cebu);
            row.WarningQuantity.ShouldBe(100m);
            row.CostPrice.ShouldBeNull();
        }

        await using (var admin = shop.Database.CreateContext())
        {
            (await admin.Branches.SingleAsync(b => b.Id == shop.Cebu)).IsActive = false;
            await admin.SaveChangesAsync();
        }

        await using var db2 = shop.Database.CreateContext(new FixedTenant(Tenant), everywhere);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            new SaveItemBranchSettingsHandler(db2, TestRequest.As(shop.UserId, AppRoles.Admin, "UTC"), TestFakes.Audit(), TestFakes.Alerts(db2))
                .Handle(new SaveItemBranchSettingsCommand(shop.Milk, [new ItemBranchSettingInputDto(shop.Cebu, 5m, null, null, null)], false), CancellationToken.None));
    }

    [SqlFact]
    public async Task APushToken_OfAnotherShop_IsNeverTakenOver()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var otherShop = Guid.NewGuid();
        var otherUser = Guid.NewGuid();

        await using (var seed = shop.Database.CreateContext())
        {
            seed.Tenants.Add(new Tenant { Id = otherShop, Name = "Other", Slug = "other", Status = 2, CreatedAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
            seed.Users.Add(new User { Id = otherUser, TenantId = otherShop, Username = "other", FirstName = "O", LastName = "O", PasswordHash = "x", IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = otherUser });
            await seed.SaveChangesAsync();
            seed.PushNotificationTokens.Add(new PushNotificationToken { UserId = otherUser, TenantId = otherShop, Platform = "android", Token = "device-token-1", IsActive = true, CreatedAt = DateTime.UtcNow, LastSeenAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
        }

        await using var db = shop.Database.CreateContext(new FixedTenant(Tenant));
        var updated = await PushTokenClaim.TakeOverAsync(db, "device-token-1", shop.UserId, Tenant, "android", null, DateTime.UtcNow, CancellationToken.None);

        updated.ShouldBe(0);
        await using var check = shop.Database.CreateContext();
        (await check.PushNotificationTokens.IgnoreQueryFilters().SingleAsync(t => t.Token == "device-token-1")).UserId.ShouldBe(otherUser);
    }
}
