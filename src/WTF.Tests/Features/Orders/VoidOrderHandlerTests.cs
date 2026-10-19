using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class VoidOrderHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data = new(TestDb.NewName());
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IPushNotificationService _push = TestFakes.Push();
    private readonly IHubContext<DashboardHub> _hub = TestFakes.Hub();

    private VoidOrderHandler Handler() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), _hub, _audit, _push, TestFakes.Conversations(), TestFakes.Stock(_data.Open()));

    [Fact]
    public async Task Handle_NoteOverFiveHundredCharacters_IsRejectedAndTheOrderIsUntouched()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 1);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new VoidOrderCommand(orderId, new string('n', 501)), CancellationToken.None));

        ex.Message.ShouldBe("Note cannot be longer than 500 characters.");
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Pending);
    }

    [Fact]
    public async Task Handle_UnknownOrder_ReturnsNull()
    {
        var result = await Handler().Handle(new VoidOrderCommand(Guid.NewGuid(), "x"), CancellationToken.None);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
        await _push.DidNotReceiveWithAnyArgs().SendOrderStatusChangedAsync(default!, default, default, default, default);
    }

    [Fact]
    public async Task Handle_PendingOrder_BecomesCancelledWithoutNote()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder();
        _data.AddLine(orderId, burger, 2);

        var dto = await Handler().Handle(new VoidOrderCommand(orderId), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Cancelled);
        dto.Note.ShouldBeNull();
        dto.TotalAmount.ShouldBe(200m);
        dto.UpdatedBy.ShouldBe(_userId);
        await using var db = _data.Open();
        var saved = await db.Orders.SingleAsync();
        saved.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task Handle_PendingOrderWithNote_TrimsAndStoresNote()
    {
        var orderId = _data.AddOrder();

        var dto = await Handler().Handle(new VoidOrderCommand(orderId, "  customer left  "), CancellationToken.None);

        dto!.Note.ShouldBe("customer left");
    }

    [Fact]
    public async Task Handle_PendingOrderWithWhitespaceNote_ClearsNote()
    {
        var orderId = _data.AddOrder(note: "previous note");

        var dto = await Handler().Handle(new VoidOrderCommand(orderId, "   "), CancellationToken.None);

        dto!.Note.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_CompletedOrderWithNote_BecomesRefunded()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(orderId, burger, 1, price: 90m);

        var dto = await Handler().Handle(new VoidOrderCommand(orderId, " wrong order "), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Refunded);
        dto.Note.ShouldBe("wrong order");
        dto.TotalAmount.ShouldBe(90m);
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Refunded);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public async Task Handle_CompletedOrderWithoutNote_ThrowsAndKeepsStatus(string? note)
    {
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new VoidOrderCommand(orderId, note), CancellationToken.None));

        ex.Message.ShouldBe("Refund note is required.");
        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Completed);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Theory]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Handle_AlreadyVoided_Throws(OrderStatusEnum current)
    {
        var orderId = _data.AddOrder(current);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new VoidOrderCommand(orderId, "again"), CancellationToken.None));

        ex.Message.ShouldBe("Order has already been voided.");
        await _push.DidNotReceiveWithAnyArgs().SendOrderStatusChangedAsync(default!, default, default, default, default);
    }

    [Fact]
    public async Task Handle_VoidingTwiceInARow_SecondCallThrows()
    {
        var orderId = _data.AddOrder();
        await Handler().Handle(new VoidOrderCommand(orderId), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new VoidOrderCommand(orderId), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_PendingOrderWithUnpricedLines_SnapshotsPricesIncludingAddOnOverride()
    {
        var burger = _data.AddProduct("Burger", 100);
        var cheese = _data.AddProduct("Cheese", 15, isAddOn: true);
        var bacon = _data.AddProduct("Bacon", 20, isAddOn: true);
        _data.AddAddOnPriceOverride(burger, cheese, 5m);
        var orderId = _data.AddOrder();
        var parentId = _data.AddLine(orderId, burger, 1);
        _data.AddLine(orderId, cheese, 1, parentId: parentId);
        _data.AddLine(orderId, bacon, 1, parentId: parentId, sortOrder: 1);

        var dto = await Handler().Handle(new VoidOrderCommand(orderId), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(125m);
        await using var db = _data.Open();
        var lines = await db.OrderItems.ToListAsync();
        lines.Single(l => l.ProductId == burger).Price.ShouldBe(100m);
        lines.Single(l => l.ProductId == cheese).Price.ShouldBe(5m);
        lines.Single(l => l.ProductId == bacon).Price.ShouldBe(20m);
    }

    [Fact]
    public async Task Handle_ExistingPriceSnapshot_IsNotOverwritten()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(orderId, burger, 1, price: 70m);
        await using (var db = _data.Open())
        {
            (await db.Products.SingleAsync()).Price = 150m;
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(new VoidOrderCommand(orderId, "refund"), CancellationToken.None);

        dto!.TotalAmount.ShouldBe(70m);
        await using var verify = _data.Open();
        (await verify.OrderItems.SingleAsync()).Price.ShouldBe(70m);
    }

    [Fact]
    public async Task Handle_Void_PreservesPaymentFieldsAndOverrideInfo()
    {
        var orderId = _data.AddOrder(OrderStatusEnum.Completed, paymentMethod: PaymentMethodEnum.GCash);
        await using (var db = _data.Open())
        {
            var o = await db.Orders.SingleAsync();
            o.AmountReceived = 200m;
            o.Tips = 10m;
            o.OverrideReason = "fixed";
            o.OverriddenAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(new VoidOrderCommand(orderId, "refund"), CancellationToken.None);

        dto!.PaymentMethod.ShouldBe(PaymentMethodEnum.GCash);
        dto.AmountReceived.ShouldBe(200m);
        dto.Tips.ShouldBe(10m);
        dto.OverrideReason.ShouldBe("fixed");
        dto.OverriddenAt.ShouldBe(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public async Task Handle_Void_BroadcastsAndNotifiesAndAudits()
    {
        var burger = _data.AddProduct("Burger", 100);
        var orderId = _data.AddOrder(OrderStatusEnum.Completed);
        _data.AddLine(orderId, burger, 1, price: 100m);

        await Handler().Handle(new VoidOrderCommand(orderId, "refund"), CancellationToken.None);

        var group = _hub.Clients.Group(HubNames.Groups.DashboardViewers);
        await group.Received(1).SendCoreAsync(HubNames.Events.DashboardUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
        await group.Received(1).SendCoreAsync(
            HubNames.Events.OrderUpdated, Arg.Is<object?[]>(a => a.Length == 1 && (Guid)a[0]! == orderId), Arg.Any<CancellationToken>());
        await _push.Received(1).SendOrderStatusChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == orderId), 100m, OrderStatusEnum.Refunded, _userId, Arg.Any<CancellationToken>());
        await _audit.Received(1).LogAsync(
            AuditAction.OrderVoided, AuditEntityType.Order, orderId.ToString(),
            Arg.Is<object?>(v => v!.ToString()!.Contains("Completed")),
            Arg.Is<object?>(v => v!.ToString()!.Contains("Refunded") && v.ToString()!.Contains("refund")),
            _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_VoidPending_PushesCancelledStatus()
    {
        var orderId = _data.AddOrder();

        await Handler().Handle(new VoidOrderCommand(orderId), CancellationToken.None);

        await _push.Received(1).SendOrderStatusChangedAsync(
            Arg.Any<WTF.Domain.Entities.Order>(), 0m, OrderStatusEnum.Cancelled, _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_NoRequestContext_ThrowsAndLeavesOrderPending()
    {
        var orderId = _data.AddOrder();
        var handler = new VoidOrderHandler(_data.Open(), TestRequest.None(), _hub, _audit, _push, TestFakes.Conversations(), TestFakes.Stock(_data.Open()));

        await Should.ThrowAsync<Exception>(() => handler.Handle(new VoidOrderCommand(orderId), CancellationToken.None));

        await using var db = _data.Open();
        (await db.Orders.SingleAsync()).StatusId.ShouldBe((int)OrderStatusEnum.Pending);
    }

    // Rollback after a failed save is tested against SQL Server in Database\VoidOrderDatabaseTests.cs.
}
