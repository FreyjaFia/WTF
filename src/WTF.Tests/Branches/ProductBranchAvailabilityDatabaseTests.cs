using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Features.Sync;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class ProductBranchAvailabilityDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid Makati, Guid Cebu, Guid Latte, Guid Special, Guid Pair, Guid Topping);

    // Latte: no rows (every branch). Special: Cebu only. Pair: Makati and Cebu. Topping (add-on): Cebu only, linked to Latte.
    private static async Task<Shop> OpenShopAsync()
    {
        var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 160m);
        var special = await SqlSeed.ProductAsync(database, user.Id, "Special", 180m);
        var pair = await SqlSeed.ProductAsync(database, user.Id, "Pair", 90m);
        var topping = await SqlSeed.ProductAsync(database, user.Id, "Topping", 30m);
        await using var db = database.CreateContext();
        db.Products.Single(p => p.Id == topping.Id).IsAddOn = true;
        var makati = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
        var cebu = SqlTestDatabase.MainBranch(Tenant, "CEB");
        cebu.IsMain = false;
        cebu.Name = "Cebu";
        db.Branches.Add(cebu);
        db.ProductAddOns.Add(new ProductAddOn { ProductId = latte.Id, AddOnId = topping.Id, AddOnTypeId = CatalogSeed.Extra, IsActive = true });
        db.ProductBranches.AddRange(
            Row(special.Id, cebu.Id),
            Row(pair.Id, makati),
            Row(pair.Id, cebu.Id),
            Row(topping.Id, cebu.Id));
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, makati, cebu.Id, latte.Id, special.Id, pair.Id, topping.Id);
    }

    private static ProductBranch Row(Guid productId, Guid branchId) =>
        new() { Id = Guid.NewGuid(), TenantId = Tenant, ProductId = productId, BranchId = branchId, CreatedAt = DateTime.UtcNow };

    private static WTFDbContext In(Shop shop, Guid? active) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], active, false));

    private static WTFDbContext Limited(Shop shop, Guid branch) =>
        shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([branch], branch, true));

    private static async Task<Guid[]> CatalogIdsAsync(Shop shop, Guid branch)
    {
        await using var db = In(shop, branch);
        var catalog = await new GetPosCatalogHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier), TestFakes.Features)
            .Handle(new GetPosCatalogQuery(), CancellationToken.None);
        return [.. catalog.Products.Select(p => p.Id)];
    }

    [SqlFact]
    public async Task ThePosCatalog_ListsOnlyWhatTheActiveBranchSells()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        (await CatalogIdsAsync(shop, shop.Cebu)).ShouldBe([shop.Special, shop.Pair, shop.Latte], ignoreOrder: true);
        (await CatalogIdsAsync(shop, shop.Makati)).ShouldBe([shop.Pair, shop.Latte], ignoreOrder: true);
    }

    [SqlFact]
    public async Task TheAddOnsOfTheCatalog_FollowTheSameRule()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        async Task<int> ToppingsAsync(Guid branch)
        {
            await using var db = In(shop, branch);
            var catalog = await new GetPosCatalogHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier), TestFakes.Features)
                .Handle(new GetPosCatalogQuery(), CancellationToken.None);
            return catalog.AddOnsByProductId.GetValueOrDefault(shop.Latte)?.SelectMany(g => g.Options).Count(o => o.Id == shop.Topping) ?? 0;
        }

        (await ToppingsAsync(shop.Cebu)).ShouldBe(1);
        (await ToppingsAsync(shop.Makati)).ShouldBe(0);
    }

    [SqlFact]
    public async Task AnOrderForAProductTheBranchDoesNotSell_StillSaves()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, shop.Makati);

        var order = await TestFakes.CreateOrderHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier)).Handle(new CreateOrderCommand
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(shop.Special, 1, [], null, null)],
            PaymentMethod = PaymentMethodEnum.Cash,
            AmountReceived = 200m,
        }, CancellationToken.None);

        order.TotalAmount.ShouldBe(180m);
    }

    [SqlFact]
    public async Task TheOwner_CreatesABranchOnlyProduct_AndAnEverywhereOne()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, shop.Makati);
        var handler = new CreateProductHandler(db, TestRequest.As(shop.UserId, AppRoles.Owner), TestFakes.Audit(), TestFakes.Features);

        var onlyCebu = await handler.Handle(new CreateProductCommand { Name = "Ube Bun", Code = "UBE", Price = 75m, Category = CatalogSeed.Dessert, SoldAtBranchIds = [shop.Cebu] }, default);
        var everywhere = await handler.Handle(new CreateProductCommand { Name = "Plain Bun", Code = "PLN", Price = 60m, Category = CatalogSeed.Dessert }, default);

        onlyCebu.SoldAtBranchIds.ShouldBe([shop.Cebu]);
        everywhere.SoldAtBranchIds.ShouldBeNull();
        await using var check = shop.Database.CreateContext();
        (await check.ProductBranches.CountAsync(p => p.ProductId == everywhere.Id)).ShouldBe(0);
    }

    [SqlFact]
    public async Task ABranchManager_CreatesProductsOnlyForTheirOwnBranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = Limited(shop, shop.Cebu);
        var handler = new CreateProductHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin), TestFakes.Audit(), TestFakes.Features);

        var created = await handler.Handle(new CreateProductCommand { Name = "Calamansi Cooler", Code = "CAL", Price = 95m, Category = CatalogSeed.Drink }, default);

        created.SoldAtBranchIds.ShouldBe([shop.Cebu]);
        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(
            new CreateProductCommand { Name = "Other", Code = "OTH", Price = 10m, Category = CatalogSeed.Drink, SoldAtBranchIds = [shop.Makati] }, default));
    }

    [SqlFact]
    public async Task ACashier_CannotCreateProducts()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = Limited(shop, shop.Cebu);
        var handler = new CreateProductHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier), TestFakes.Audit(), TestFakes.Features);

        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(
            new CreateProductCommand { Name = "Nope", Code = "NOP", Price = 10m, Category = CatalogSeed.Drink }, default));
    }

    [SqlFact]
    public async Task TheOwner_ChangesWhereAProductIsSold_AndBackToEverywhere()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = In(shop, shop.Makati))
        {
            var saved = await new SaveProductSoldAtHandler(db, TestRequest.As(shop.UserId, AppRoles.Owner), TestFakes.Audit())
                .Handle(new SaveProductSoldAtCommand(shop.Latte, false, [shop.Makati]), default);
            saved!.IsAllBranches.ShouldBeFalse();
            saved.Branches.Single(b => b.BranchId == shop.Cebu).IsSoldHere.ShouldBeFalse();
        }

        (await CatalogIdsAsync(shop, shop.Cebu)).ShouldNotContain(shop.Latte);

        await using (var db = In(shop, shop.Makati))
        {
            var saved = await new SaveProductSoldAtHandler(db, TestRequest.As(shop.UserId, AppRoles.Owner), TestFakes.Audit())
                .Handle(new SaveProductSoldAtCommand(shop.Latte, true, null), default);
            saved!.IsAllBranches.ShouldBeTrue();
        }

        (await CatalogIdsAsync(shop, shop.Cebu)).ShouldContain(shop.Latte);
    }

    [SqlFact]
    public async Task AProductMustKeepAtLeastOneBranch_WhenNotSoldEverywhere()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, shop.Makati);

        await Should.ThrowAsync<InvalidOperationException>(() => new SaveProductSoldAtHandler(db, TestRequest.As(shop.UserId, AppRoles.Owner), TestFakes.Audit())
            .Handle(new SaveProductSoldAtCommand(shop.Latte, false, []), default));
    }

    [SqlFact]
    public async Task ABranchManager_ChangesOnlyProductsLimitedToTheirBranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = Limited(shop, shop.Cebu);
        var handler = new SaveProductSoldAtHandler(db, TestRequest.As(shop.UserId, AppRoles.Admin), TestFakes.Audit());

        var own = await handler.Handle(new SaveProductSoldAtCommand(shop.Special, false, [shop.Cebu]), default);
        own!.CanChange.ShouldBeTrue();
        own.CanSellEverywhere.ShouldBeFalse();

        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(new SaveProductSoldAtCommand(shop.Latte, false, [shop.Cebu]), default));
        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(new SaveProductSoldAtCommand(shop.Pair, false, [shop.Cebu]), default));
        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(new SaveProductSoldAtCommand(shop.Special, true, null), default));
        await Should.ThrowAsync<ForbiddenActionException>(() => handler.Handle(new SaveProductSoldAtCommand(shop.Special, false, [shop.Makati]), default));
    }

    [SqlFact]
    public async Task TheProductList_ShowsSoldAt_AndFiltersByBranch()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using var db = In(shop, shop.Makati);

        var page = await new GetPagedProductsHandler(db, TestRequest.As(shop.UserId, AppRoles.Owner))
            .Handle(new GetPagedProductsQuery(IsAddOn: false, SoldAtBranchId: shop.Makati), default);

        page.Items.Select(p => p.Id).ShouldBe([shop.Latte, shop.Pair], ignoreOrder: true);
        page.Items.Single(p => p.Id == shop.Pair).SoldAtBranchIds!.Count.ShouldBe(2);
        page.Items.Single(p => p.Id == shop.Latte).SoldAtBranchIds.ShouldBeNull();
        page.Facets!["soldat:limited"].ShouldBe(2);
        page.Facets[$"soldat:{shop.Cebu}"].ShouldBe(3);

        var limited = await new GetPagedProductsHandler(db, TestRequest.As(shop.UserId, AppRoles.Owner))
            .Handle(new GetPagedProductsQuery(IsAddOn: false, LimitedOnly: true), default);
        limited.Items.Select(p => p.Id).ShouldBe([shop.Special, shop.Pair], ignoreOrder: true);
    }

    [SqlFact]
    public async Task TheBundles_HideWhatTheBranchCannotFullySell()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        await using (var seed = shop.Database.CreateContext())
        {
            var duo = new Promotion { Id = Guid.NewGuid(), Name = "Latte and Special", TypeId = PromotionTypeIds.FixedBundle, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = shop.UserId };
            duo.FixedBundlePromotion = new FixedBundlePromotion { PromotionId = duo.Id, BundlePrice = 300m };
            duo.FixedBundlePromotion.FixedBundlePromotionItems.Add(new FixedBundlePromotionItem { Id = Guid.NewGuid(), FixedBundlePromotionId = duo.Id, ProductId = shop.Latte, Quantity = 1 });
            duo.FixedBundlePromotion.FixedBundlePromotionItems.Add(new FixedBundlePromotionItem { Id = Guid.NewGuid(), FixedBundlePromotionId = duo.Id, ProductId = shop.Special, Quantity = 1 });
            seed.Promotions.Add(duo);
            await seed.SaveChangesAsync();
        }

        async Task<int> BundlesAtAsync(Guid branch)
        {
            await using var db = In(shop, branch);
            var bundles = await new GetPosBundlesHandler(db, TestRequest.As(shop.UserId, AppRoles.Cashier), TestFakes.Features)
                .Handle(new GetPosBundlesQuery(), CancellationToken.None);
            return bundles.FixedBundles.Count;
        }

        (await BundlesAtAsync(shop.Cebu)).ShouldBe(1);
        (await BundlesAtAsync(shop.Makati)).ShouldBe(0);
    }
}
