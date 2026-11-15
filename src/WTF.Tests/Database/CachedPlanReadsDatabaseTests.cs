using WTF.Api.Common.Auth;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Dashboard;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class CachedPlanReadsDatabaseTests
{
    private static WTFDbContext ShopContext(SqlTestDatabase database) =>
        database.CreateContext(new FixedTenant(TenantDefaults.DefaultTenantId));

    [SqlFact]
    public async Task TheOrderLinkCheck_ReadsThePlanOnceThroughTheCache_EvenWhenAnotherFeatureIsRequired()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var token = await SeedLinkAsync(database);
        var counting = new CountingFeatures(PlanFeatures.Parse("orderlinks,chat"));

        await using var db = database.CreateContext(new SwitchableTenant());
        (await OrderLinkAccess.ResolveAsync(db, token, CancellationToken.None, counting, alsoRequires: PlanFeatures.Chat)).ShouldNotBeNull();

        counting.Calls.ShouldBe(1);
    }

    [SqlFact]
    public async Task ThePublicChatList_ReadsThePlanThroughTheCache()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var token = await SeedLinkAsync(database);
        var counting = new CountingFeatures(PlanFeatures.Parse("orderlinks"));

        await using var db = database.CreateContext(new SwitchableTenant());
        (await new GetPublicConversationsHandler(db, counting).Handle(new GetPublicConversationsQuery(token), CancellationToken.None)).ShouldBeNull();

        counting.Calls.ShouldBe(1);
    }

    [SqlFact]
    public async Task ThePendingOrderList_ChecksPromotionsThroughTheCache()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 150m);
        var accessor = TestRequest.As(user.Id, AppRoles.Admin, "UTC");
        await using (var db = ShopContext(database))
        {
            var create = new CreateOrderCommand { Status = OrderStatusEnum.Pending, Items = [new OrderItemRequestDto(latte.Id, 1, [], null, null)] };
            await TestFakes.CreateOrderHandler(db, accessor).Handle(create, CancellationToken.None);
        }

        var counting = new CountingFeatures(PlanFeatures.Parse("reports"));
        await using (var db = ShopContext(database))
        {
            (await new GetOrdersHandler(db, counting, accessor).Handle(new GetOrdersQuery(), CancellationToken.None)).Count.ShouldBe(1);
        }

        counting.Calls.ShouldBe(1);

        var pagedCounting = new CountingFeatures(PlanFeatures.Parse("reports"));
        await using (var db = ShopContext(database))
        {
            (await new GetPagedOrdersHandler(db, pagedCounting, accessor).Handle(new GetPagedOrdersQuery(), CancellationToken.None)).Items.Count.ShouldBe(1);
        }

        pagedCounting.Calls.ShouldBe(1);
    }

    [SqlFact]
    public async Task TheDashboard_ReadsThePlanOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var counting = new CountingFeatures(PlanFeatures.Parse("inventory"));

        await using var db = ShopContext(database);
        await new GetDashboardHandler(db, TestRequest.As(user.Id, AppRoles.Owner, "UTC"), counting).Handle(new GetDashboardQuery("today", null, null), CancellationToken.None);

        counting.Calls.ShouldBe(1);
    }

    private static async Task<string> SeedLinkAsync(SqlTestDatabase database)
    {
        var user = await SqlSeed.UserAsync(database);
        var token = OrderLinkToken.Generate();
        await using var seed = database.CreateContext();
        var customer = new Customer { Id = Guid.NewGuid(), FirstName = "C", LastName = "One", IsActive = true, AllowOrderingLink = true, CreatedAt = FixedClock.Today, CreatedBy = user.Id };
        seed.Customers.Add(customer);
        seed.ShortLinks.Add(new ShortLink { Id = Guid.NewGuid(), Token = token, TargetType = OrderLinkToken.TargetType, TargetId = customer.Id, CreatedAt = FixedClock.Today, CreatedBy = user.Id });
        await seed.SaveChangesAsync();
        return token;
    }
}
