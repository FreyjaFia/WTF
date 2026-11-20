using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Dashboard;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class PlanGatingDatabaseTests
{
    private static WTFDbContext ShopContext(SqlTestDatabase database) =>
        database.CreateContext(new FixedTenant(TenantDefaults.DefaultTenantId));

    private static async Task SetPlanAsync(SqlTestDatabase database, string features)
    {
        await using var db = database.CreateContext();
        var sub = await db.TenantSubscriptions.SingleOrDefaultAsync();
        if (sub is null)
        {
            var plan = new Plan { Code = "test", Name = "Test", MonthlyPrice = 1, Features = features, IsActive = true, SortOrder = 1 };
            db.Plans.Add(plan);
            await db.SaveChangesAsync();
            db.TenantSubscriptions.Add(new TenantSubscription
            {
                TenantId = TenantDefaults.DefaultTenantId,
                PlanId = plan.Id,
                CurrentPeriodStart = FixedClock.Today.AddDays(-5),
                CurrentPeriodEnd = FixedClock.Today.AddDays(300),
                GraceDays = 7,
                UpdatedAt = FixedClock.Today,
            });
        }
        else
        {
            (await db.Plans.SingleAsync(p => p.Id == sub.PlanId)).Features = features;
        }

        await db.SaveChangesAsync();
    }

    private static CreateOrderHandler Handler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);

    private static CreateOrderCommand Sale(Guid productId, int quantity = 1) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, quantity, [], null, null)],
    };

    [SqlFact]
    public async Task ASaleOnAPlanWithoutInventory_Saves_AndTakesNoStock_ThenDeductsWhenInventoryReturns()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        await using (var seed = database.CreateContext())
        {
            var milk = new Item { Id = Guid.NewGuid(), Name = "Oat Milk", UnitName = "ml", CurrentQuantity = 1000m, AllowNegativeStock = true, IsActive = true, CreatedAt = FixedClock.Today, CreatedBy = user.Id };
            seed.Items.Add(milk);
            seed.ProductItemLinks.Add(new ProductItemLink { Id = Guid.NewGuid(), ProductId = latte.Id, ItemId = milk.Id, QuantityPerSale = 200m, IsActive = true, CreatedAt = FixedClock.Today, CreatedBy = user.Id });
            await seed.SaveChangesAsync();
        }

        await SetPlanAsync(database, string.Empty);
        await using (var db = ShopContext(database))
        {
            var dto = await Handler(db, user.Id).Handle(Sale(latte.Id), CancellationToken.None);
            dto.ShouldNotBeNull();
        }

        await using (var check = database.CreateContext())
        {
            (await check.Orders.CountAsync()).ShouldBe(1);
            (await check.QuantityOfOnlyItemAsync()).ShouldBe(1000m);
            (await check.StockMovements.CountAsync()).ShouldBe(0);
        }

        await SetPlanAsync(database, "inventory");
        await using (var db = ShopContext(database))
        {
            await Handler(db, user.Id).Handle(Sale(latte.Id), CancellationToken.None);
        }

        await using var after = database.CreateContext();
        (await after.Orders.CountAsync()).ShouldBe(2);
        (await after.QuantityOfOnlyItemAsync()).ShouldBe(800m);
    }

    [SqlFact]
    public async Task APlanWithoutPromotions_SellsAtTheNormalPrice_AndTheRegisterGetsNoPromotions_ButOldOrdersStayReadable()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        await using (var seed = database.CreateContext())
        {
            var promo = new Promotion { Id = Guid.NewGuid(), Name = "Half off", TypeId = PromotionTypeIds.DiscountedProduct, IsActive = true, CreatedAt = FixedClock.Today, CreatedBy = user.Id };
            promo.DiscountedProductPromotions.Add(new DiscountedProductPromotion { Id = Guid.NewGuid(), PromotionId = promo.Id, ProductId = latte.Id, PercentOff = 50m });
            seed.Promotions.Add(promo);
            await seed.SaveChangesAsync();
        }

        var accessor = TestRequest.As(user.Id, AppRoles.Admin, "UTC");

        await SetPlanAsync(database, "promotions");
        OrderDto withPromotions;
        await using (var db = ShopContext(database))
        {
            withPromotions = await Handler(db, user.Id).Handle(Sale(latte.Id), CancellationToken.None);
            (await new GetActiveDiscountedProductPromotionsHandler(db, accessor, TestFakes.Features)
                .Handle(new GetActiveDiscountedProductPromotionsQuery(null, false), CancellationToken.None)).Count.ShouldBe(1);
        }

        withPromotions.TotalAmount.ShouldBe(75m);

        await SetPlanAsync(database, string.Empty);
        await using (var db = ShopContext(database))
        {
            var plain = await Handler(db, user.Id).Handle(Sale(latte.Id), CancellationToken.None);
            plain.TotalAmount.ShouldBe(150m);
            (await new GetActiveDiscountedProductPromotionsHandler(db, accessor, TestFakes.Features)
                .Handle(new GetActiveDiscountedProductPromotionsQuery(null, false), CancellationToken.None)).ShouldBeEmpty();
            var bundles = await new GetPosBundlesHandler(db, accessor, TestFakes.Features).Handle(new GetPosBundlesQuery(), CancellationToken.None);
            bundles.FixedBundles.ShouldBeEmpty();
            bundles.MixMatch.ShouldBeEmpty();

            var old = await new GetOrderByIdHandler(db, TestFakes.Features, accessor).Handle(new GetOrderByIdQuery(withPromotions.Id), CancellationToken.None);
            old.ShouldNotBeNull();
            old.TotalAmount.ShouldBe(75m);
        }
    }

    [SqlFact]
    public async Task ABundleSale_NeedsThePromotionsFeature_RefusedOnline_AndHeldOffline()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var promotionId = await DbOrderSeed.FixedBundleAsync(database, user.Id, burger.Id, 80m);

        static CreateOrderCommand BundleSale(Guid productId, Guid promotionId) => new()
        {
            Status = OrderStatusEnum.Completed,
            Items = [new OrderItemRequestDto(productId, 1, [], null, promotionId, QuotedPrice: 80m)],
            BundlePromotions = [new OrderBundlePromotionRequestDto(promotionId, 1, 80m)],
        };

        await SetPlanAsync(database, "promotions");
        await using (var db = ShopContext(database))
        {
            var sold = await Handler(db, user.Id).Handle(BundleSale(burger.Id, promotionId), CancellationToken.None);
            sold.TotalAmount.ShouldBe(80m);
        }

        await SetPlanAsync(database, string.Empty);
        await using (var db = ShopContext(database))
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(
                Handler(db, user.Id).Handle(BundleSale(burger.Id, promotionId), CancellationToken.None));
            ex.Message.ShouldContain("not part of this shop's plan");
        }

        await using (var db = ShopContext(database))
        {
            var reasons = await OfflineOrderReview.FindReasonsAsync(
                db, BundleSale(burger.Id, promotionId), TimeZoneInfo.Utc, CancellationToken.None, TestFakes.Features);
            reasons.ShouldContain(r => r.Contains("not part of this shop's plan"));
        }

        await SetPlanAsync(database, "promotions");
        await using (var db = ShopContext(database))
        {
            var reasons = await OfflineOrderReview.FindReasonsAsync(
                db, BundleSale(burger.Id, promotionId), TimeZoneInfo.Utc, CancellationToken.None, TestFakes.Features);
            reasons.ShouldBeEmpty();
        }
    }

    [SqlFact]
    public async Task TheOrderLinkPage_RefusesAShopWithoutOrderLinks_KeepsTheLinkValid_AndChatFollowsItsOwnFeature()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var token = OrderLinkToken.Generate();
        await using (var seed = database.CreateContext())
        {
            var customer = new Customer { Id = Guid.NewGuid(), FirstName = "C", LastName = "One", IsActive = true, AllowOrderingLink = true, CreatedAt = FixedClock.Today, CreatedBy = user.Id };
            seed.Customers.Add(customer);
            seed.ShortLinks.Add(new ShortLink { Id = Guid.NewGuid(), Token = token, TargetType = OrderLinkToken.TargetType, TargetId = customer.Id, CreatedAt = FixedClock.Today, CreatedBy = user.Id });
            await seed.SaveChangesAsync();
        }

        async Task<bool> OpensAsync()
        {
            await using var db = database.CreateContext(new SwitchableTenant());
            try
            {
                return await OrderLinkAccess.ResolveAsync(db, token, CancellationToken.None, TestFakes.Features) is not null;
            }
            catch (ShopUnavailableException ex)
            {
                ex.ShopName.ShouldNotBeNullOrWhiteSpace();
                return false;
            }
        }

        async Task<bool> ChatOpensAsync()
        {
            await using var db = database.CreateContext(new SwitchableTenant());
            return await new GetPublicConversationsHandler(db, TestFakes.Features).Handle(new GetPublicConversationsQuery(token), CancellationToken.None) is not null;
        }

        await SetPlanAsync(database, string.Empty);
        (await OpensAsync()).ShouldBeFalse();

        await SetPlanAsync(database, "orderlinks");
        (await OpensAsync()).ShouldBeTrue();
        (await ChatOpensAsync()).ShouldBeFalse();

        await SetPlanAsync(database, "orderlinks,chat");
        (await ChatOpensAsync()).ShouldBeTrue();
    }

    [SqlFact]
    public async Task TheDashboard_ReadsNoStockCardsWithoutInventory()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var seed = database.CreateContext())
        {
            seed.Items.Add(new Item { Id = Guid.NewGuid(), Name = "Beans", UnitName = "g", CurrentQuantity = 0m, WarningQuantity = 100m, CriticalQuantity = 10m, IsActive = true, CreatedAt = FixedClock.Today, CreatedBy = user.Id });
            await seed.SaveChangesAsync();
        }

        var accessor = TestRequest.As(user.Id, AppRoles.Owner, "UTC");

        await SetPlanAsync(database, "inventory");
        await using (var db = ShopContext(database))
        {
            var dto = await new GetDashboardHandler(db, accessor, TestFakes.Features).Handle(new GetDashboardQuery("today", null, null), CancellationToken.None);
            dto.Insights!.OutOfStockCount.ShouldBe(1);
            dto.Profit.ShouldNotBeNull();
        }

        await SetPlanAsync(database, string.Empty);
        await using (var db = ShopContext(database))
        {
            var dto = await new GetDashboardHandler(db, accessor, TestFakes.Features).Handle(new GetDashboardQuery("today", null, null), CancellationToken.None);
            dto.Insights!.OutOfStockCount.ShouldBe(0);
            dto.Insights.LowStockCount.ShouldBe(0);
            dto.Profit.ShouldBeNull();
        }
    }

    [SqlFact]
    public async Task TheRegisterStockLimits_AreEmptyWithoutInventory()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var seed = database.CreateContext())
        {
            seed.Items.Add(new Item { Id = Guid.NewGuid(), Name = "Cups", UnitName = "pc", CurrentQuantity = 3m, AllowNegativeStock = false, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = user.Id });
            await seed.SaveChangesAsync();
        }

        await SetPlanAsync(database, "inventory");
        await using (var db = ShopContext(database))
        {
            var limits = await new GetPosStockLimitsHandler(db, TestFakes.Features).Handle(new GetPosStockLimitsQuery(), CancellationToken.None);
            limits.Items.Single().Name.ShouldBe("Cups");
        }

        await SetPlanAsync(database, string.Empty);
        await using (var db = ShopContext(database))
        {
            var limits = await new GetPosStockLimitsHandler(db, TestFakes.Features).Handle(new GetPosStockLimitsQuery(), CancellationToken.None);
            limits.Items.ShouldBeEmpty();
            limits.Links.ShouldBeEmpty();
        }
    }

}
