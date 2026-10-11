using MediatR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class CreateOrderBatchHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();

    /// <summary>Wires the batch handler to the real single-order handler, sharing one context as a scoped request would.</summary>
    private CreateOrderBatchHandler Handler()
    {
        var db = TestDb.Create(_dbName);
        var single = new CreateOrderHandler(db, TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations());
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<CreateOrderCommand>(), Arg.Any<CancellationToken>())
            .Returns(call => single.Handle(call.Arg<CreateOrderCommand>(), call.Arg<CancellationToken>()));
        return new CreateOrderBatchHandler(db, sender);
    }

    private async Task<Guid> SeedProduct(string name, decimal price, bool active = true)
    {
        await using var db = TestDb.Create(_dbName);
        var p = new Product { Id = Guid.NewGuid(), Name = name, Price = price, IsActive = active, Code = name, CreatedAt = DateTime.UtcNow, CreatedBy = _userId };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return p.Id;
    }

    private static CreateOrderCommand Order(Guid productId, int qty = 1, OrderStatusEnum status = OrderStatusEnum.Pending) =>
        new() { Status = status, Items = [new OrderItemRequestDto(productId, qty, [], null, null)] };

    [Fact]
    public async Task Handle_EmptyBatch_ReturnsEmptyListAndCreatesNothing()
    {
        var result = await Handler().Handle(new CreateOrderBatchCommand([]), CancellationToken.None);

        result.ShouldBeEmpty();
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_ManyOrders_AreCreatedAndReturnedInRequestOrder()
    {
        var a = await SeedProduct("A", 10m);
        var b = await SeedProduct("B", 20m);
        var c = await SeedProduct("C", 30m);

        var result = await Handler().Handle(
            new CreateOrderBatchCommand([Order(a, 1), Order(b, 2), Order(c, 3, OrderStatusEnum.Completed)]), CancellationToken.None);

        result.Count.ShouldBe(3);
        result.Select(r => r.TotalAmount).ShouldBe([10m, 40m, 90m]);
        result.Select(r => r.Items.Single().ProductName).ShouldBe(["A", "B", "C"]);
        result.Select(r => r.Status).ShouldBe([OrderStatusEnum.Pending, OrderStatusEnum.Pending, OrderStatusEnum.Completed]);
        result.Select(r => r.Id).Distinct().Count().ShouldBe(3);

        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(3);
        (await db.OrderItems.CountAsync()).ShouldBe(3);
    }

    [Fact]
    public async Task Handle_SingleOrderBatch_ReturnsThatOrder()
    {
        var a = await SeedProduct("A", 10m);

        var result = await Handler().Handle(new CreateOrderBatchCommand([Order(a)]), CancellationToken.None);

        result.Single().CreatedBy.ShouldBe(_userId);
    }

    [Fact]
    public async Task Handle_FailingOrder_PropagatesTheException()
    {
        var good = await SeedProduct("Good", 10m);
        var inactive = await SeedProduct("Gone", 10m, active: false);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new CreateOrderBatchCommand([Order(good), Order(inactive), Order(good)]), CancellationToken.None));

        ex.Message.ShouldContain("Gone");
    }

    [Fact]
    public async Task Handle_FailingOrder_StopsProcessingLaterOrders()
    {
        var good = await SeedProduct("Good", 10m);
        var inactive = await SeedProduct("Gone", 10m, active: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new CreateOrderBatchCommand([Order(good), Order(inactive), Order(good)]), CancellationToken.None));

        // The in-memory provider ignores the transaction so the first order stays; the third was never attempted.
        await using var db = TestDb.Create(_dbName);
        (await db.Orders.CountAsync()).ShouldBe(1);
    }

    // Rollback of the earlier orders when one fails is covered against a real SQL Server in
    // Database/CreateOrderDatabaseTests.cs.
}
