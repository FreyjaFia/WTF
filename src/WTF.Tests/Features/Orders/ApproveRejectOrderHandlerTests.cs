using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class ApproveRejectOrderHandlerTests
{
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly OrderSeed _data = new(TestDb.NewName());
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IHubContext<DashboardHub> _hub = TestFakes.Hub();
    private readonly IConversationNotifier _conversations = Substitute.For<IConversationNotifier>();

    private ISender Sender()
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto?>>(), Arg.Any<CancellationToken>())
            .Returns(call => new GetOrderByIdHandler(_data.Open())
                .Handle((GetOrderByIdQuery)call.Arg<IRequest<OrderDto?>>(), call.Arg<CancellationToken>()));
        return sender;
    }

    private ApproveOrderHandler Approve() =>
        new(_data.Open(), TestRequest.As(_staffId, AppRoles.Cashier), _hub, _audit, _conversations, Sender());

    private MarkOrderReadyHandler Ready() =>
        new(_data.Open(), TestRequest.As(_staffId, AppRoles.Cashier), _hub, _audit, _conversations, Sender());

    private RejectOrderHandler Reject() =>
        new(_data.Open(), TestRequest.As(_staffId, AppRoles.Cashier), _hub, _audit, _conversations, Sender());

    private Guid AddWaitingOrder(OrderStatusEnum status = OrderStatusEnum.PendingApproval)
    {
        var customer = _data.AddCustomer("Maria", "Cruz");
        var burger = _data.AddProduct("Burger", 100);
        var id = _data.AddOrder(status, customer);
        _data.AddLine(id, burger, 2);
        return id;
    }

    private async Task<(int StatusId, string? Reason, Guid? UpdatedBy)> StateAsync(Guid id)
    {
        await using var db = _data.Open();
        var order = await db.Orders.SingleAsync(o => o.Id == id);
        return (order.StatusId, order.RejectionReason, order.UpdatedBy);
    }

    // --- approve ---

    [Fact]
    public async Task Approve_WaitingOrder_BecomesPendingAndJoinsTheNormalFlow()
    {
        var id = AddWaitingOrder();

        var dto = await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Status.ShouldBe(OrderStatusEnum.Pending);
        var state = await StateAsync(id);
        state.StatusId.ShouldBe((int)OrderStatusEnum.Pending);
        state.UpdatedBy.ShouldBe(_staffId);
        state.Reason.ShouldBeNull();
    }

    [Fact]
    public async Task Approve_IsAuditedAndTellsOpenScreens()
    {
        var id = AddWaitingOrder();

        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.OrderApproved, AuditEntityType.Order, id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _staffId, Arg.Any<CancellationToken>());
        await _hub.Clients.Group(HubNames.Groups.DashboardViewers).Received(1)
            .SendCoreAsync(HubNames.Events.OrderUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
        await _hub.Clients.Group(HubNames.Groups.DashboardViewers).Received(1)
            .SendCoreAsync(HubNames.Events.DashboardUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Approve_TellsTheCustomersPageAtOnce()
    {
        var id = AddWaitingOrder();

        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == id), Arg.Any<WTF.Domain.Entities.Conversation?>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Reject_TellsTheCustomersPageAtOnce()
    {
        var id = AddWaitingOrder();

        await Reject().Handle(new RejectOrderCommand(id, "Closed today"), CancellationToken.None);

        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == id), Arg.Any<WTF.Domain.Entities.Conversation?>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Ready_TellsTheCustomersPageAtOnce()
    {
        var id = AddAcceptedLinkOrder();

        await Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None);

        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == id), Arg.Any<WTF.Domain.Entities.Conversation?>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ARefusedChange_TellsNobody()
    {
        var id = AddWaitingOrder(OrderStatusEnum.Completed);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None));

        await _conversations.DidNotReceiveWithAnyArgs().OrderChangedAsync(default!, default, default);
    }

    [Fact]
    public async Task Approve_UnknownOrder_ReturnsNull()
    {
        (await Approve().Handle(new ApproveOrderCommand(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Approve_AnythingButAWaitingOrder_IsRefusedAndLeftAlone(OrderStatusEnum status)
    {
        var id = AddWaitingOrder(status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None));

        ex.Message.ShouldBe("Only orders waiting for approval can be accepted.");
        (await StateAsync(id)).StatusId.ShouldBe((int)status);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Approve_TwiceInARow_SecondTimeIsRefused()
    {
        var id = AddWaitingOrder();
        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None));
        await _audit.Received(1).LogAsync(
            AuditAction.OrderApproved, AuditEntityType.Order, id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    // --- reject ---

    [Fact]
    public async Task Reject_WaitingOrder_BecomesCancelledWithTheTrimmedReason()
    {
        var id = AddWaitingOrder();

        var dto = await Reject().Handle(new RejectOrderCommand(id, "  Out of stock today  "), CancellationToken.None);

        dto!.Status.ShouldBe(OrderStatusEnum.Cancelled);
        dto.RejectionReason.ShouldBe("Out of stock today");
        var state = await StateAsync(id);
        state.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        state.Reason.ShouldBe("Out of stock today");
        state.UpdatedBy.ShouldBe(_staffId);
    }

    [Fact]
    public async Task Reject_IsAuditedWithTheReasonAndTellsOpenScreens()
    {
        var id = AddWaitingOrder();

        await Reject().Handle(new RejectOrderCommand(id, "Closed"), CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.OrderRejected, AuditEntityType.Order, id.ToString(),
            Arg.Any<object?>(), Arg.Is<object?>(v => v != null && v.ToString()!.Contains("Closed")),
            _staffId, Arg.Any<CancellationToken>());
        await _hub.Clients.Group(HubNames.Groups.DashboardViewers).Received(1)
            .SendCoreAsync(HubNames.Events.OrderUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("    ")]
    public async Task Reject_WithoutAReason_IsRefusedAndLeftWaiting(string? reason)
    {
        var id = AddWaitingOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Reject().Handle(new RejectOrderCommand(id, reason!), CancellationToken.None));

        ex.Message.ShouldBe("A reason is required to reject an order.");
        (await StateAsync(id)).StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
    }

    [Fact]
    public async Task Reject_ReasonOverFiveHundredCharacters_IsRefused()
    {
        var id = AddWaitingOrder();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Reject().Handle(new RejectOrderCommand(id, new string('r', 501)), CancellationToken.None));

        ex.Message.ShouldContain("500 characters");
        (await StateAsync(id)).StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
    }

    [Fact]
    public async Task Reject_UnknownOrder_ReturnsNull()
    {
        (await Reject().Handle(new RejectOrderCommand(Guid.NewGuid(), "x"), CancellationToken.None)).ShouldBeNull();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Reject_AnythingButAWaitingOrder_IsRefusedAndLeftAlone(OrderStatusEnum status)
    {
        var id = AddWaitingOrder(status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Reject().Handle(new RejectOrderCommand(id, "no"), CancellationToken.None));

        ex.Message.ShouldBe("Only orders waiting for approval can be rejected.");
        var state = await StateAsync(id);
        state.StatusId.ShouldBe((int)status);
        state.Reason.ShouldBeNull();
    }

    [Fact]
    public async Task Reject_ThenApprove_IsRefused()
    {
        var id = AddWaitingOrder();
        await Reject().Handle(new RejectOrderCommand(id, "no"), CancellationToken.None);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None));
        (await StateAsync(id)).StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
    }

    // --- a revoked link does not undo the orders already placed through it ---

    [Fact]
    public async Task Approve_AndReject_StillWorkForAnOrderWhoseLinkWasRevoked()
    {
        var link = new WTF.Domain.Entities.ShortLink
        {
            Id = Guid.NewGuid(), Token = "t", TargetType = "CustomerOrder", RevokedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        await TestDb.SaveAsync(_data.DbName, link);
        var toApprove = AddWaitingOrder();
        var toReject = AddWaitingOrder();
        await using (var db = _data.Open())
        {
            foreach (var order in db.Orders)
            {
                order.OrderLinkId = link.Id;
            }

            await db.SaveChangesAsync();
        }

        (await Approve().Handle(new ApproveOrderCommand(toApprove), CancellationToken.None))!.Status.ShouldBe(OrderStatusEnum.Pending);
        (await Reject().Handle(new RejectOrderCommand(toReject, "no"), CancellationToken.None))!.Status.ShouldBe(OrderStatusEnum.Cancelled);
    }

    // --- progress: accepted time, then ready ---

    private Guid AddAcceptedLinkOrder(
        OrderStatusEnum status = OrderStatusEnum.Pending, OrderSourceEnum source = OrderSourceEnum.CustomerLink)
    {
        var id = AddWaitingOrder(status);
        using var db = _data.Open();
        var order = db.Orders.Single(o => o.Id == id);
        order.Source = (byte)source;
        order.FulfillmentType = (byte)FulfillmentTypeEnum.Delivery;
        db.SaveChanges();
        return id;
    }

    private async Task<(DateTime? AcceptedAt, DateTime? ReadyAt, Guid? UpdatedBy)> TimesAsync(Guid id)
    {
        await using var db = _data.Open();
        var order = await db.Orders.SingleAsync(o => o.Id == id);
        return (order.AcceptedAt, order.ReadyAt, order.UpdatedBy);
    }

    [Fact]
    public async Task Approve_StampsWhenTheOrderWasAccepted()
    {
        var id = AddWaitingOrder();
        var before = DateTime.UtcNow;

        var dto = await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        var times = await TimesAsync(id);
        times.AcceptedAt.ShouldNotBeNull();
        times.AcceptedAt!.Value.ShouldBeGreaterThanOrEqualTo(before);
        times.ReadyAt.ShouldBeNull();
        dto!.AcceptedAt.ShouldBe(times.AcceptedAt);
        dto.ReadyAt.ShouldBeNull();
    }

    [Fact]
    public async Task Ready_AcceptedCustomerOrder_IsStampedAuditedAndTellsOpenScreens()
    {
        var id = AddAcceptedLinkOrder();

        var dto = await Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None);

        var times = await TimesAsync(id);
        times.ReadyAt.ShouldNotBeNull();
        times.UpdatedBy.ShouldBe(_staffId);
        dto!.ReadyAt.ShouldBe(times.ReadyAt);
        dto.Status.ShouldBe(OrderStatusEnum.Pending, "ready is progress, not a new status: the order is still open");
        await _audit.Received(1).LogAsync(
            AuditAction.OrderMarkedReady, AuditEntityType.Order, id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _staffId, Arg.Any<CancellationToken>());
        await _hub.Clients.Group(HubNames.Groups.DashboardViewers).Received(1)
            .SendCoreAsync(HubNames.Events.OrderUpdated, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Ready_UnknownOrder_ReturnsNull()
    {
        (await Ready().Handle(new MarkOrderReadyCommand(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task Ready_ASecondTime_IsRefusedAndKeepsTheFirstTime()
    {
        var id = AddAcceptedLinkOrder();
        await Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None);
        var first = (await TimesAsync(id)).ReadyAt;

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None));

        ex.Message.ShouldBe("This order is already marked ready.");
        (await TimesAsync(id)).ReadyAt.ShouldBe(first);
    }

    [Theory]
    [InlineData(OrderStatusEnum.PendingApproval)]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task Ready_OnlyAnAcceptedOrder_AndNotOneStillWaitingOrAlreadyFinished(OrderStatusEnum status)
    {
        var id = AddAcceptedLinkOrder(status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None));

        ex.Message.ShouldBe("Only accepted orders can be marked ready.");
        (await TimesAsync(id)).ReadyAt.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Ready_AnOrderTheShopTookItself_IsRefused()
    {
        var id = AddAcceptedLinkOrder(source: OrderSourceEnum.Pos);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None));

        ex.Message.ShouldBe("Only orders placed through a customer link can be marked ready.");
    }

    // --- what the customer then sees ---

    [Fact]
    public void ARejectedOrderReadsRejectedToTheCustomer_AnApprovedOneAccepted()
    {
        PublicOrderMapping.StatusOf((int)OrderStatusEnum.Cancelled, "Closed today").Label.ShouldBe("Rejected");
        PublicOrderMapping.StatusOf((int)OrderStatusEnum.Pending, null).Label.ShouldBe("Accepted");
    }

    // --- the line the order's chat shows ---

    private async Task<List<WTF.Domain.Entities.ConversationMessage>> ChatLinesAsync(Guid orderId)
    {
        await using var db = _data.Open();
        return await db.ConversationMessages
            .Where(m => m.Conversation.OrderId == orderId)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync();
    }

    [Fact]
    public async Task Approve_WritesAnAcceptedLineIntoTheChat_NamingWhoDidIt()
    {
        var id = AddAcceptedLinkOrder(OrderStatusEnum.PendingApproval);

        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        var line = (await ChatLinesAsync(id)).ShouldHaveSingleItem();
        line.SenderType.ShouldBe((byte)WTF.Api.Features.Conversations.MessageSender.System);
        line.Body.ShouldBe("Order accepted");
        line.SenderUserId.ShouldBe(_staffId);
        line.ReadByStaffAt.ShouldBeNull();
        line.ReadByCustomerAt.ShouldBeNull();
    }

    [Fact]
    public async Task Approve_TellsOpenChatsAboutTheNewLine()
    {
        var id = AddAcceptedLinkOrder(OrderStatusEnum.PendingApproval);

        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        await _conversations.Received(1).OrderChangedAsync(
            Arg.Any<WTF.Domain.Entities.Order>(), Arg.Is<WTF.Domain.Entities.Conversation?>(c => c != null),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Reject_WritesTheReasonIntoTheChat()
    {
        var id = AddAcceptedLinkOrder(OrderStatusEnum.PendingApproval);

        await Reject().Handle(new RejectOrderCommand(id, "Closed today"), CancellationToken.None);

        (await ChatLinesAsync(id)).ShouldHaveSingleItem().Body.ShouldBe("Order rejected: Closed today");
    }

    [Theory]
    [InlineData(FulfillmentTypeEnum.Delivery, "Order is ready for delivery")]
    [InlineData(FulfillmentTypeEnum.Pickup, "Order is ready for pickup")]
    public async Task Ready_WritesWhereItIsReady(FulfillmentTypeEnum type, string expected)
    {
        var id = AddAcceptedLinkOrder();
        await using (var db = _data.Open())
        {
            (await db.Orders.SingleAsync(o => o.Id == id)).FulfillmentType = (byte)type;
            await db.SaveChangesAsync();
        }

        await Ready().Handle(new MarkOrderReadyCommand(id), CancellationToken.None);

        (await ChatLinesAsync(id)).ShouldHaveSingleItem().Body.ShouldBe(expected);
    }

    [Fact]
    public async Task Approve_AnOrderTheShopTookItself_StartsNoChat()
    {
        var id = AddAcceptedLinkOrder(OrderStatusEnum.PendingApproval, OrderSourceEnum.Pos);

        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        (await ChatLinesAsync(id)).ShouldBeEmpty();
        await _conversations.Received(1).OrderChangedAsync(
            Arg.Any<WTF.Domain.Entities.Order>(), null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ASystemLineIsNeverUnread()
    {
        var id = AddAcceptedLinkOrder(OrderStatusEnum.PendingApproval);

        await Approve().Handle(new ApproveOrderCommand(id), CancellationToken.None);

        await using var db = _data.Open();
        var conversationId = (await db.Conversations.SingleAsync(c => c.OrderId == id)).Id;
        (await WTF.Api.Features.Conversations.ConversationStore.UnreadForStaffAsync(db, conversationId, default)).ShouldBe(0);
        (await WTF.Api.Features.Conversations.ConversationStore.UnreadForCustomerAsync(db, conversationId, default)).ShouldBe(0);
    }
}
