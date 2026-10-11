using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using WTF.Api.Features.Conversations;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Entities;

namespace WTF.Tests.Services;

public class ConversationNotifierTests
{
    private static readonly Guid CustomerId = Guid.NewGuid();
    private static readonly Guid LinkId = Guid.NewGuid();

    private readonly IClientProxy _staff = Substitute.For<IClientProxy>();
    private readonly IClientProxy _customer = Substitute.For<IClientProxy>();
    private readonly IClientProxy _link = Substitute.For<IClientProxy>();
    private readonly IPushNotificationService _push = Substitute.For<IPushNotificationService>();
    private readonly ConversationNotifier _notifier;

    private readonly Order _order = new() { Id = Guid.NewGuid(), OrderNumber = 1042, CustomerId = CustomerId };
    private readonly Conversation _conversation = new() { Id = Guid.NewGuid() };

    public ConversationNotifierTests()
    {
        var staffHub = Substitute.For<IHubContext<StaffOrderHub>>();
        staffHub.Clients.Group(HubNames.Groups.StaffOrders).Returns(_staff);

        var customerHub = Substitute.For<IHubContext<CustomerOrderHub>>();
        customerHub.Clients.Group(HubNames.Groups.Customer(CustomerId)).Returns(_customer);
        customerHub.Clients.Group(HubNames.Groups.Link(LinkId)).Returns(_link);

        _notifier = new ConversationNotifier(staffHub, customerHub, _push, NullLogger<ConversationNotifier>.Instance);
    }

    private ConversationMessage Message(MessageSender sender, string body = "Is 5pm ok?") =>
        new() { Id = Guid.NewGuid(), SenderType = (byte)sender, Body = body };

    private static Task Heard(IClientProxy proxy, string method, int times = 1) =>
        proxy.Received(times).SendCoreAsync(method, Arg.Any<object?[]>(), Arg.Any<CancellationToken>());

    // --- a message was sent ---

    [Fact]
    public async Task ACustomersMessage_ReachesStaffAndTheCustomersOtherPages_AndPushesToStaff()
    {
        await _notifier.MessageSentAsync(_order, _conversation, Message(MessageSender.Customer), "Maria Cruz", default);

        await Heard(_staff, HubNames.Events.OrderMessageReceived);
        await Heard(_customer, HubNames.Events.OrderMessageReceived);
        await _push.Received(1).SendOrderMessageAsync(_order, "Maria Cruz", "Is 5pm ok?", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task TheMessage_CarriesTheConversationAndOrderIds_NotItsText()
    {
        await _notifier.MessageSentAsync(_order, _conversation, Message(MessageSender.Customer, "secret"), "Maria", default);

        var call = _staff.ReceivedCalls().Single(c => c.GetMethodInfo().Name == "SendCoreAsync");
        var args = (object?[])call.GetArguments()[1]!;
        args.ShouldBe([_conversation.Id, _order.Id]);
    }

    [Fact]
    public async Task AStaffReply_ReachesBothSides_ButDoesNotPushToStaff()
    {
        await _notifier.MessageSentAsync(_order, _conversation, Message(MessageSender.Staff), null, default);

        await Heard(_staff, HubNames.Events.OrderMessageReceived);
        await Heard(_customer, HubNames.Events.OrderMessageReceived);
        await _push.DidNotReceiveWithAnyArgs().SendOrderMessageAsync(default!, default, default!, default);
    }

    [Fact]
    public async Task AnOrderWithNoCustomer_OnlyReachesStaff()
    {
        _order.CustomerId = null;

        await _notifier.MessageSentAsync(_order, _conversation, Message(MessageSender.Staff), null, default);

        await Heard(_staff, HubNames.Events.OrderMessageReceived);
        await Heard(_customer, HubNames.Events.OrderMessageReceived, 0);
    }

    [Fact]
    public async Task AFailedNotification_IsSwallowed_BecauseTheMessageIsAlreadySaved()
    {
        _staff.SendCoreAsync(default!, default!, default).ThrowsForAnyArgs(new InvalidOperationException("hub down"));
        _push.SendOrderMessageAsync(default!, default, default!, default).ThrowsForAnyArgs(new InvalidOperationException("fcm down"));

        await Should.NotThrowAsync(() =>
            _notifier.MessageSentAsync(_order, _conversation, Message(MessageSender.Customer), "Maria", default));
    }

    // --- a chat was read ---

    [Fact]
    public async Task StaffReading_UpdatesTheOtherStaffsBadges_ButNotTheCustomer()
    {
        await _notifier.ConversationReadAsync(_order, _conversation, MessageSender.Staff, default);

        await Heard(_staff, HubNames.Events.ConversationRead);
        await Heard(_customer, HubNames.Events.ConversationRead, 0);
    }

    [Fact]
    public async Task CustomerReading_UpdatesStaffAndTheCustomersOtherPages()
    {
        await _notifier.ConversationReadAsync(_order, _conversation, MessageSender.Customer, default);

        await Heard(_staff, HubNames.Events.ConversationRead);
        await Heard(_customer, HubNames.Events.ConversationRead);
    }

    // --- the order changed / the link was revoked ---

    [Fact]
    public async Task AnOrderChange_GoesToTheCustomersPagesAndTheStaff()
    {
        await _notifier.OrderChangedAsync(_order, null, default);

        await Heard(_customer, HubNames.Events.OrderStatusChanged);
        await Heard(_staff, HubNames.Events.OrderStatusChanged);
        await Heard(_customer, HubNames.Events.OrderMessageReceived, 0);
        await Heard(_staff, HubNames.Events.OrderMessageReceived, 0);
    }

    [Fact]
    public async Task AnOrderChange_WithASystemLine_AlsoTellsOpenChatsOnBothSides()
    {
        await _notifier.OrderChangedAsync(_order, _conversation, default);

        await Heard(_customer, HubNames.Events.OrderMessageReceived);
        await Heard(_staff, HubNames.Events.OrderMessageReceived);
    }

    [Fact]
    public async Task AnOrderChange_WithNoCustomer_SendsNothing()
    {
        _order.CustomerId = null;

        await _notifier.OrderChangedAsync(_order, null, default);

        await Heard(_customer, HubNames.Events.OrderStatusChanged, 0);
    }

    [Fact]
    public async Task ARevokedLink_GoesToThePagesOpenThroughThatLink()
    {
        await _notifier.LinkRevokedAsync(LinkId, default);

        await Heard(_link, HubNames.Events.LinkRevoked);
        await Heard(_customer, HubNames.Events.LinkRevoked, 0);
    }
}
