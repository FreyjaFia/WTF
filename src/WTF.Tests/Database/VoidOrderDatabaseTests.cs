using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Voiding an order against a real SQL Server: the status change and price snapshot are one transaction.</summary>
public class VoidOrderDatabaseTests
{
    private static VoidOrderHandler Handler(WTF.Domain.Data.WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push());

    [SqlFact]
    public async Task Handle_FailureWhileSaving_RollsBackStatusAndPrices()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id, 2);

        // A rule that exists only in this test database forbids the Cancelled status, so the order UPDATE fails
        // after the line prices were set. (An over-long note no longer works for this: the handler rejects it
        // up front with a clear message.)
        await using (var db = database.CreateContext())
        {
            await db.Database.ExecuteSqlRawAsync(
                $"ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Test_NoCancel CHECK (StatusId <> {(int)OrderStatusEnum.Cancelled})");
        }

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<DbUpdateException>(() =>
                Handler(db, user.Id).Handle(new VoidOrderCommand(orderId, "changed my mind"), CancellationToken.None));
            ex.InnerException.ShouldNotBeNull();
        }

        await using var check = database.CreateContext();
        var order = await check.Orders.SingleAsync();
        order.StatusId.ShouldBe((int)OrderStatusEnum.Pending);
        order.Note.ShouldBeNull();
        order.UpdatedAt.ShouldBeNull();
        order.UpdatedBy.ShouldBeNull();
        (await check.OrderItems.SingleAsync()).Price.ShouldBeNull();
    }

    [SqlFact]
    public async Task Handle_PendingOrder_IsCancelledAndPricesAreSnapshotted()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id, 2);

        await using (var db = database.CreateContext())
        {
            var dto = await Handler(db, user.Id).Handle(new VoidOrderCommand(orderId, "  changed mind "), CancellationToken.None);
            dto!.Status.ShouldBe(OrderStatusEnum.Cancelled);
            dto.TotalAmount.ShouldBe(200m);
        }

        // The product price changes later: the voided order keeps the price it was cancelled at.
        await using (var db = database.CreateContext())
        {
            (await db.Products.SingleAsync()).Price = 999m;
            await db.SaveChangesAsync();
        }

        await using var check = database.CreateContext();
        var order = await check.Orders.SingleAsync();
        order.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        order.Note.ShouldBe("changed mind");
        order.UpdatedBy.ShouldBe(user.Id);
        (await check.OrderItems.SingleAsync()).Price.ShouldBe(100m);
    }

    [SqlFact]
    public async Task Handle_VoidedTwice_SecondCallIsRejectedAndNothingChanges()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(new VoidOrderCommand(orderId, "first"), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Handler(db, user.Id).Handle(new VoidOrderCommand(orderId, "second"), CancellationToken.None));
            ex.Message.ShouldBe("Order has already been voided.");
        }

        await using var check = database.CreateContext();
        var order = await check.Orders.SingleAsync();
        order.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        order.Note.ShouldBe("first");
    }

    [SqlFact]
    public async Task Handle_CompletedOrderWithoutNote_IsRejectedAndKeepsItsPrices()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id, OrderStatusEnum.Completed);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id, price: 80m);

        await using (var db = database.CreateContext())
        {
            var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
                Handler(db, user.Id).Handle(new VoidOrderCommand(orderId), CancellationToken.None));
            ex.Message.ShouldBe("Refund note is required.");
        }

        await using var check = database.CreateContext();
        (await check.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Completed);
        (await check.OrderItems.SingleAsync()).Price.ShouldBe(80m);
    }

    [SqlFact]
    public async Task Handle_CompletedOrderWithNote_IsRefundedAndKeepsPaidPrices()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var burger = await SqlSeed.ProductAsync(database, user.Id, "Burger", 100m);
        var orderId = await DbOrderSeed.OrderAsync(database, user.Id, OrderStatusEnum.Completed);
        await DbOrderSeed.LineAsync(database, orderId, burger.Id, price: 80m);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(new VoidOrderCommand(orderId, "wrong order"), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        (await check.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Refunded);
        (await check.OrderItems.SingleAsync()).Price.ShouldBe(80m);
    }
}
