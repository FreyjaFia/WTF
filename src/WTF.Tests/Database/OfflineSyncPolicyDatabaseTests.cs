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

public class OfflineSyncPolicyDatabaseTests
{
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");

    [SqlFact]
    public async Task ASavedPolicyWithNoCodesListed_KeepsEveryCodeOnHold()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);

        await using (var db = database.CreateContext(new Shop(TenantDefaults.DefaultTenantId)))
        {
            var handler = new UpdateOfflineSyncPolicyHandler(db, TestRequest.As(user.Id, AppRoles.Owner), TestFakes.Audit());
            await handler.Handle(new UpdateOfflineSyncPolicyCommand([], 0m, false, 2), CancellationToken.None);
        }

        await using var read = database.CreateContext(new Shop(TenantDefaults.DefaultTenantId));
        var row = await read.OfflineSyncPolicies.SingleAsync();
        new[]
        {
            row.PriceChangedMode, row.AddOnPriceChangedMode, row.ProductInactiveMode, row.BundleChangedMode,
            row.CustomerInactiveMode, row.PromotionEndedMode, row.UnknownProductMode
        }.ShouldAllBe(mode => mode == 1);
        row.PriceTolerance.ShouldBe(0m);
        row.AutoApproveNotes.ShouldBeFalse();
        row.AgedAfterDays.ShouldBe(2);
    }

    [SqlFact]
    public async Task Update_SavesThroughTheRealForeignKeys_AndEachShopKeepsItsOwnPolicy()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await using (var setup = database.CreateContext())
        {
            setup.Tenants.Add(new Tenant { Id = TenantB, Name = "Shop B", Slug = "shop-b", Status = 2, CreatedAt = DateTime.UtcNow });
            await setup.SaveChangesAsync();
        }

        await using (var a = database.CreateContext(new Shop(TenantDefaults.DefaultTenantId)))
        {
            var handler = new UpdateOfflineSyncPolicyHandler(a, TestRequest.As(user.Id, AppRoles.Owner), TestFakes.Audit());
            await handler.Handle(new UpdateOfflineSyncPolicyCommand([new OfflineSyncCodeModeDto("CustomerInactive", "Note")], 5m, true, 4), CancellationToken.None);
        }

        await using var readA = database.CreateContext(new Shop(TenantDefaults.DefaultTenantId));
        var policyA = await new GetOfflineSyncPolicyHandler(readA).Handle(new GetOfflineSyncPolicyQuery(), CancellationToken.None);
        policyA.PriceTolerance.ShouldBe(5m);
        policyA.AgedAfterDays.ShouldBe(4);
        policyA.Codes.Single(c => c.Code == "CustomerInactive").Mode.ShouldBe("Note");
        (await readA.OfflineSyncPolicies.SingleAsync()).UpdatedBy.ShouldBe(user.Id);

        await using var readB = database.CreateContext(new Shop(TenantB));
        var policyB = await new GetOfflineSyncPolicyHandler(readB).Handle(new GetOfflineSyncPolicyQuery(), CancellationToken.None);
        policyB.PriceTolerance.ShouldBe(0m);
        policyB.Codes.ShouldAllBe(c => c.Mode == "Hold");
        (await readB.OfflineSyncPolicies.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task Sync_WithAToleranceOf5_SavesAThreePesoDifferenceAsCompleted_AndHoldsASixPesoOne()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var near = await SqlSeed.ProductAsync(database, user.Id, "Near", 153m);
        var far = await SqlSeed.ProductAsync(database, user.Id, "Far", 156m);
        await using (var setup = database.CreateContext(new Shop(TenantDefaults.DefaultTenantId)))
        {
            setup.OfflineSyncPolicies.Add(new OfflineSyncPolicy
            {
                TenantId = TenantDefaults.DefaultTenantId,
                PriceTolerance = 5m,
                PriceChangedMode = 1,
                AddOnPriceChangedMode = 1,
                ProductInactiveMode = 1,
                BundleChangedMode = 1,
                CustomerInactiveMode = 1,
                PromotionEndedMode = 1,
                UnknownProductMode = 1,
                AgedAfterDays = 2,
                UpdatedBy = user.Id,
            });
            await setup.SaveChangesAsync();
        }

        await using var db = database.CreateContext(new Shop(TenantDefaults.DefaultTenantId));
        var handler = SyncHandler(db, user.Id);
        var results = await handler.Handle(
            new SyncOfflineOrdersCommand([Order("DB-1", near.Id, 150m), Order("DB-2", far.Id, 150m)]), CancellationToken.None);

        results[0].Status.ShouldBe(OrderStatusEnum.Completed);
        results[0].ReasonDetails!.Single().Severity.ShouldBe("Note");
        results[1].Status.ShouldBe(OrderStatusEnum.PendingReview);
    }

    private static SyncOfflineOrdersHandler SyncHandler(WTFDbContext db, Guid userId)
    {
        var accessor = TestRequest.As(userId, AppRoles.Admin);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor);
    }

    private static CreateOrderCommand Order(string localId, Guid productId, decimal quoted) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null, quoted)],
        OfflineLocalId = localId,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 1000m,
    };

    private sealed class Shop(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
