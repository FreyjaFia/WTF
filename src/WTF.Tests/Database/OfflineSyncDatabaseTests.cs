using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class OfflineSyncDatabaseTests
{
    private static SyncOfflineOrdersHandler Handler(WTFDbContext db, Guid userId)
    {
        var accessor = TestRequest.As(userId, AppRoles.Admin);
        var create = new CreateOrderHandler(db, accessor, TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations());
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => create.Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        return new SyncOfflineOrdersHandler(db, sender, accessor);
    }

    private static CreateOrderCommand Order(string localId, params OrderItemRequestDto[] items) => new()
    {
        Status = OrderStatusEnum.Completed,
        Items = [.. items],
        OfflineLocalId = localId,
        PaymentMethod = PaymentMethodEnum.Cash,
        AmountReceived = 1000m,
    };

    [SqlFact]
    public async Task Sync_AnOrderThatFailsHalfWay_LeavesNothingBehindAndTheNextOrderIsSaved()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        var discount = await SqlSeed.ProductAsync(database, user.Id, "Discount", 10m);

        // A discount add-on costing -50 pushes the latte to a negative price, which is only noticed after the order row
        // and its first lines were already written.
        await using (var setup = database.CreateContext())
        {
            discount.IsAddOn = true;
            setup.Products.Update(discount);
            setup.ProductAddOns.Add(new ProductAddOn { ProductId = latte.Id, AddOnId = discount.Id, AddOnTypeId = 4, IsActive = true });
            setup.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(),
                ProductId = latte.Id,
                AddOnId = discount.Id,
                Price = -150m,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            });
            await setup.SaveChangesAsync();
        }

        List<OfflineSyncResultDto> results;
        await using (var db = database.CreateContext())
        {
            var bad = Order("OFF-1-aaaa", new OrderItemRequestDto(latte.Id, 1, [new OrderItemRequestDto(discount.Id, 1, [], null, null)], null, null));
            var good = Order("OFF-2-aaaa", new OrderItemRequestDto(latte.Id, 1, [], null, null));
            results = await Handler(db, user.Id).Handle(new SyncOfflineOrdersCommand([bad, good]), CancellationToken.None);
        }

        results[0].Error.ShouldNotBeNull();
        results[1].Error.ShouldBeNull();
        await using var check = database.CreateContext();
        var saved = await check.Orders.Include(o => o.OrderItems).SingleAsync();
        saved.OfflineLocalId.ShouldBe("OFF-2-aaaa");
        saved.OrderItems.Count.ShouldBe(1);
    }

    [SqlFact]
    public async Task Database_TheSameQueueNumberTwice_IsRejectedByTheUniqueIndex()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        await DbOrderSeed.OrderAsync(database, user.Id, orderNumber: 900);

        await using var db = database.CreateContext();
        var orders = await db.Orders.ToListAsync();
        orders.Single().OfflineLocalId = "OFF-1-aaaa";
        await db.SaveChangesAsync();

        await using var second = database.CreateContext();
        await DbOrderSeed.OrderAsync(database, user.Id, orderNumber: 901);
        var other = await second.Orders.SingleAsync(o => o.OrderNumber == 901);
        other.OfflineLocalId = "OFF-1-aaaa";

        await Should.ThrowAsync<DbUpdateException>(() => second.SaveChangesAsync());
    }

    [SqlFact]
    public async Task Sync_AHeldOrderSavesWithRealForeignKeysAndTheNewStatusRow()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 160m);

        List<OfflineSyncResultDto> results;
        await using (var db = database.CreateContext())
        {
            var order = Order("OFF-3-aaaa", new OrderItemRequestDto(latte.Id, 2, [], null, null, 150m));
            results = await Handler(db, user.Id).Handle(new SyncOfflineOrdersCommand([order]), CancellationToken.None);
        }

        results.Single().Status.ShouldBe(OrderStatusEnum.PendingReview);
        await using var check = database.CreateContext();
        var saved = await check.Orders.SingleAsync();
        saved.StatusId.ShouldBe((int)OrderStatusEnum.PendingReview);
        saved.QuotedTotal.ShouldBe(300m);
    }
}
