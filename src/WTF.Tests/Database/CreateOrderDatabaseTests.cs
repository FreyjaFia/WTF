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
        new(db, TestRequest.As(userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push());

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
