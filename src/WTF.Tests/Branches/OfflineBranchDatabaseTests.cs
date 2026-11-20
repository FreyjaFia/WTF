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
using WTF.Tests.Database;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class OfflineBranchDatabaseTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private sealed record Shop(SqlTestDatabase Database, Guid UserId, Guid ProductId, Guid Makati, Guid Cebu);

    private static async Task<Shop> OpenShopAsync()
    {
        var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 160m);
        await using var db = database.CreateContext();
        var makati = await db.Branches.Where(b => b.IsMain).Select(b => b.Id).SingleAsync();
        var cebu = SqlTestDatabase.MainBranch(Tenant, "CEB");
        cebu.IsMain = false;
        cebu.Name = "Cebu";
        db.Branches.Add(cebu);
        await db.SaveChangesAsync();
        return new Shop(database, user.Id, latte.Id, makati, cebu.Id);
    }

    private static CreateOrderCommand Order(string localId, Guid productId, Guid? branchId, decimal price = 160m) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null, price)],
        OfflineLocalId = localId,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 500m,
        ExpectedTotal = price,
        BranchId = branchId,
    };

    private static SyncOfflineOrdersHandler SyncHandler(WTFDbContext db, Guid userId)
    {
        var accessor = TestRequest.As(userId, AppRoles.Cashier);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor, TestFakes.Features);
    }

    [SqlFact]
    public async Task AQueuedOrder_IsSavedInTheBranchItWasSoldIn_NotTheBranchOpenWhenItSyncs()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], shop.Makati, false)))
        {
            var results = await SyncHandler(db, shop.UserId).Handle(new SyncOfflineOrdersCommand([Order("OFF-1-aaaa", shop.ProductId, shop.Cebu)]), CancellationToken.None);
            results.Single().Error.ShouldBeNull();
        }

        await using var check = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await check.Orders.SingleAsync()).BranchId.ShouldBe(shop.Cebu);
    }

    [SqlFact]
    public async Task ABranchThatDoesNotExist_FallsBackToTheOpenBranchInsteadOfFailing()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], shop.Cebu, false)))
        {
            var results = await SyncHandler(db, shop.UserId).Handle(new SyncOfflineOrdersCommand([Order("OFF-2-aaaa", shop.ProductId, Guid.NewGuid())]), CancellationToken.None);
            results.Single().Error.ShouldBeNull();
        }

        await using var check = shop.Database.CreateContext(new FixedTenant(Tenant));
        (await check.Orders.SingleAsync()).BranchId.ShouldBe(shop.Cebu);
    }

    [SqlFact]
    public async Task AnUnsyncedOrder_BelongsToItsBranch_AndEachBranchSeesOnlyItsOwn()
    {
        var shop = await OpenShopAsync();
        await using var _ = shop.Database;
        var missing = Guid.NewGuid();

        await using (var db = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], null, false)))
        {
            var handler = SyncHandler(db, shop.UserId);
            await handler.Handle(new SyncOfflineOrdersCommand([Order("OFF-3-aaaa", missing, shop.Makati)]), CancellationToken.None);
            await handler.Handle(new SyncOfflineOrdersCommand([Order("OFF-4-bbbb", missing, shop.Cebu)]), CancellationToken.None);
        }

        await using var cebu = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Cebu], shop.Cebu, true));
        (await cebu.UnsyncedOrders.Select(u => u.OfflineLocalId).ToListAsync()).ShouldBe(["OFF-4-bbbb"]);

        await using var all = shop.Database.CreateContext(new FixedTenant(Tenant), new FixedBranch([shop.Makati, shop.Cebu], null, false));
        var rows = await all.UnsyncedOrders.OrderBy(u => u.OfflineLocalId).ToListAsync();
        rows.Select(r => r.BranchId).ShouldBe([shop.Makati, shop.Cebu]);
    }
}
