using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class UnsyncedOrderDatabaseTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    private static CreateOrderCommand Order(string localId, Guid productId) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null, 100m)],
        OfflineLocalId = localId,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 500m,
        ExpectedTotal = 100m,
    };

    private static SyncOfflineOrdersHandler SyncHandler(WTFDbContext db, Guid userId)
    {
        var accessor = TestRequest.As(userId, AppRoles.Cashier);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor);
    }

    private static async Task SeedTenantsAsync(SqlTestDatabase database)
    {
        await using var db = database.CreateContext();
        db.Tenants.AddRange(
            new Tenant { Id = TenantA, Name = "Shop A", Slug = "shop-a", Status = 2, CreatedAt = DateTime.UtcNow },
            new Tenant { Id = TenantB, Name = "Shop B", Slug = "shop-b", Status = 2, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
    }

    private static UnsyncedOrder Row(string localId, Guid cashierId) => new()
    {
        Id = Guid.NewGuid(),
        OfflineLocalId = localId,
        QuotedOrderJson = "{}",
        ErrorText = "One or more selected products/add-ons were not found.",
        ErrorCode = "NotFound",
        CashierUserId = cashierId,
        ReceivedAt = DateTime.UtcNow,
        StatusId = (byte)UnsyncedOrderStatusEnum.Open,
    };

    [SqlFact]
    public async Task Sync_AFailedOrder_IsStoredAfterItsTransactionRolledBack_AndSavingTheFixResolvesIt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var missing = Guid.NewGuid();

        await using (var db = database.CreateContext())
        {
            var results = await SyncHandler(db, user.Id).Handle(new SyncOfflineOrdersCommand([Order("OFF-1-aaaa", missing)]), CancellationToken.None);
            results.Single().Error.ShouldNotBeNull();
        }

        await using (var check = database.CreateContext())
        {
            (await check.Orders.CountAsync()).ShouldBe(0);
            var row = await check.UnsyncedOrders.SingleAsync();
            row.StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Open);
            row.CashierUserId.ShouldBe(user.Id);
        }

        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        await using (var db = database.CreateContext())
        {
            var results = await SyncHandler(db, user.Id).Handle(new SyncOfflineOrdersCommand([Order("OFF-1-aaaa", product.Id)]), CancellationToken.None);
            results.Single().Error.ShouldBeNull();
        }

        await using var after = database.CreateContext();
        var resolved = await after.UnsyncedOrders.SingleAsync();
        resolved.StatusId.ShouldBe((byte)UnsyncedOrderStatusEnum.Resolved);
        resolved.ResultingOrderId.ShouldBe((await after.Orders.SingleAsync()).Id);
    }

    [SqlFact]
    public async Task Discard_TwiceAtOnce_LetsOnlyTheFirstWin()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        Guid id;
        await using (var db = database.CreateContext())
        {
            var row = Row("OFF-1-aaaa", user.Id);
            db.UnsyncedOrders.Add(row);
            await db.SaveChangesAsync();
            id = row.Id;
        }

        await using var first = database.CreateContext();
        await using var second = database.CreateContext();
        var accessor = TestRequest.As(user.Id, AppRoles.Admin);
        await new DiscardUnsyncedOrderHandler(first, accessor, TestFakes.Audit()).Handle(new DiscardUnsyncedOrderCommand(id, "Duplicate"), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            new DiscardUnsyncedOrderHandler(second, accessor, TestFakes.Audit()).Handle(new DiscardUnsyncedOrderCommand(id, "Again"), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            new NoteOnlyUnsyncedOrderHandler(second, accessor, TestFakes.Hub(), TestFakes.Audit()).Handle(new NoteOnlyUnsyncedOrderCommand(id), CancellationToken.None));
        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0);
        (await check.UnsyncedOrders.SingleAsync()).DiscardReason.ShouldBe("Duplicate");
    }

    [SqlFact]
    public async Task NoteOnly_SavesACancelledOrderWithoutLinesOnSqlServer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        Guid id;
        await using (var db = database.CreateContext())
        {
            var row = Row("OFF-1-aaaa", user.Id);
            row.QuotedOrderJson = System.Text.Json.JsonSerializer.Serialize(Order("OFF-1-aaaa", Guid.NewGuid()), System.Text.Json.JsonSerializerOptions.Web);
            row.QuotedTotal = 100m;
            db.UnsyncedOrders.Add(row);
            await db.SaveChangesAsync();
            id = row.Id;
        }

        await using (var db = database.CreateContext())
        {
            var detail = await new NoteOnlyUnsyncedOrderHandler(db, TestRequest.As(user.Id, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit())
                .Handle(new NoteOnlyUnsyncedOrderCommand(id), CancellationToken.None);
            detail!.Order.ResultingOrderId.ShouldNotBeNull();
        }

        await using var check = database.CreateContext();
        var order = await check.Orders.SingleAsync();
        order.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        order.OfflineLocalId.ShouldBe("OFF-1-aaaa");
        order.QuotedTotal.ShouldBe(100m);
        (await check.OrderItems.CountAsync()).ShouldBe(0);
        (await check.UnsyncedOrders.SingleAsync()).ResultingOrderId.ShouldBe(order.Id);
    }

    [SqlFact]
    public async Task Multi_AShopNeverSeesAnotherShopsUnsyncedOrders_AndTheSameQueueNumberIsAllowedInBoth()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await SeedTenantsAsync(database);

        foreach (var tenant in new[] { TenantA, TenantB })
        {
            await using var db = database.CreateContext(new FixedTenant(tenant));
            db.UnsyncedOrders.Add(Row("OFF-1-aaaa", user.Id));
            await db.SaveChangesAsync();
        }

        await using var readA = database.CreateContext(new FixedTenant(TenantA));
        var seenByA = await new GetUnsyncedOrdersHandler(readA).Handle(new GetUnsyncedOrdersQuery(), CancellationToken.None);
        seenByA.TotalCount.ShouldBe(1);
        var idOfB = await database.CreateContext().UnsyncedOrders.IgnoreQueryFilters().Where(u => u.TenantId == TenantB).Select(u => u.Id).SingleAsync();
        (await new GetUnsyncedOrderByIdHandler(readA).Handle(new GetUnsyncedOrderByIdQuery(idOfB), CancellationToken.None)).ShouldBeNull();
        (await new DiscardUnsyncedOrderHandler(readA, TestRequest.As(user.Id, AppRoles.Admin), TestFakes.Audit())
            .Handle(new DiscardUnsyncedOrderCommand(idOfB, "Not mine"), CancellationToken.None)).ShouldBeNull();
        await using var unfiltered = database.CreateContext();
        (await unfiltered.UnsyncedOrders.CountAsync()).ShouldBe(2);
    }

    [SqlFact]
    public async Task Multi_TheSameQueueNumberTwiceInOneShop_IsRejectedByTheUniqueIndex()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using var db = database.CreateContext();
        db.UnsyncedOrders.Add(Row("OFF-1-aaaa", user.Id));
        await db.SaveChangesAsync();

        db.UnsyncedOrders.Add(Row("OFF-1-aaaa", user.Id));
        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
