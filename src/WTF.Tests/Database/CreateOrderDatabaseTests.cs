using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>
/// Order creation against a real SQL Server: the order number sequence and the transactions that undo a
/// half-finished order. The in-memory provider can show neither.
/// </summary>
public class CreateOrderDatabaseTests
{
    private static CreateOrderHandler Handler(WTFDbContext db, Guid userId) =>
        new(db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db));

    private static CreateOrderCommand Order(params Guid[] productIds) => new()
    {
        Status = OrderStatusEnum.Pending,
        Items = [.. productIds.Select(id => new OrderItemRequestDto(id, 1, [], null, null))],
    };

    [SqlFact]
    public async Task Handle_NewOrders_GetIncreasingOrderNumbersFromTheSequence()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(Order(product.Id), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(Order(product.Id), CancellationToken.None);
        }

        await using var check = database.CreateContext();
        var numbers = await check.Orders.OrderBy(o => o.OrderNumber).Select(o => o.OrderNumber).ToListAsync();
        numbers.Count.ShouldBe(2);
        numbers[0].ShouldBe(5); // the model starts OrderNumberSeq at 5
        numbers[1].ShouldBe(numbers[0] + 1);
    }

    /// <summary>
    /// A sender that runs each order through the real create-order handler on the SAME context, the way the request
    /// scope does in the API, so the batch's transaction and the orders' transactions meet on one connection.
    /// </summary>
    private static ISender SameContextSender(WTFDbContext db, Guid userId)
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(call => Handler(db, userId).Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>()));
        return sender;
    }

    [SqlFact]
    public async Task Batch_SeveralOrdersInOneTransaction_AreAllSaved()
    {
        // This is the offline sync: one transaction around the batch, and each order opens its own on the same
        // connection. SQL Server refuses a second transaction on a connection that already has one, so the order
        // handler must join the batch's transaction instead of starting another.
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var db = database.CreateContext())
        {
            var results = await new CreateOrderBatchHandler(db, SameContextSender(db, user.Id)).Handle(
                new CreateOrderBatchCommand([Order(product.Id), Order(product.Id), Order(product.Id)]),
                CancellationToken.None);

            results.Count.ShouldBe(3);
        }

        await using var check = database.CreateContext();
        var numbers = await check.Orders.OrderBy(o => o.OrderNumber).Select(o => o.OrderNumber).ToListAsync();
        numbers.Count.ShouldBe(3);
        numbers[1].ShouldBe(numbers[0] + 1);
        numbers[2].ShouldBe(numbers[1] + 1);
    }

    [SqlFact]
    public async Task Batch_OneBadOrder_UndoesTheOrdersBeforeIt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<InvalidOperationException>(() => new CreateOrderBatchHandler(db, SameContextSender(db, user.Id))
                .Handle(new CreateOrderBatchCommand([Order(product.Id), Order(Guid.NewGuid())]), CancellationToken.None));
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0, "a failed order in a batch must undo the ones saved before it");
        (await check.OrderItems.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task Handle_AloneStillOpensAndCommitsItsOwnTransaction()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(Order(product.Id), CancellationToken.None);
            db.Database.CurrentTransaction.ShouldBeNull("it commits and disposes the transaction it started");
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(1);
    }

    [SqlFact]
    public async Task Handle_FailureAfterTheOrderRowIsSaved_RollsBackEverything()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        // The second product does not exist: the handler only finds out after it has already saved the order row.
        await using (var db = database.CreateContext())
        {
            await Should.ThrowAsync<InvalidOperationException>(() =>
                Handler(db, user.Id).Handle(Order(product.Id, Guid.NewGuid()), CancellationToken.None));
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0);
        (await check.OrderItems.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task BatchHandle_WhenALaterOrderFails_RollsBackTheEarlierOnes()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var product = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);

        await using (var db = database.CreateContext())
        {
            // Wire the batch handler to the real single-order handler on one context, as one scoped request would.
            var single = Handler(db, user.Id);
            var sender = Substitute.For<ISender>();
            sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
                .Returns(call => single.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
            var batch = new CreateOrderBatchHandler(db, sender);

            await Should.ThrowAsync<InvalidOperationException>(() => batch.Handle(
                new CreateOrderBatchCommand([Order(product.Id), Order(product.Id), Order(Guid.NewGuid())]),
                CancellationToken.None));
        }

        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0);
        (await check.OrderItems.CountAsync()).ShouldBe(0);
    }
}
