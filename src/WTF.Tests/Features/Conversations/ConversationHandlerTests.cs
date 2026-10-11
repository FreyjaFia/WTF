using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Conversations;

public class ConversationHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly Guid _systemUserId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IConversationNotifier _notifier = Substitute.For<IConversationNotifier>();

    // --- handlers ---

    private SendStaffMessageHandler StaffSend() =>
        new(TestDb.Create(_db), TestRequest.As(_staffId, AppRoles.Cashier), _audit, _notifier);

    private GetOrderConversationHandler StaffGet() => new(TestDb.Create(_db));

    private MarkConversationReadHandler StaffRead() => new(TestDb.Create(_db), _notifier);

    private GetConversationsHandler StaffList() => new(TestDb.Create(_db));

    private SendPublicMessageHandler PublicSend() =>
        new(TestDb.Create(_db), _audit, _notifier, TimeProvider.System);

    private GetPublicOrderConversationHandler PublicGet() => new(TestDb.Create(_db));

    private GetPublicConversationsHandler PublicList() => new(TestDb.Create(_db));

    private MarkPublicConversationReadHandler PublicRead() => new(TestDb.Create(_db), TimeProvider.System, _notifier);

    // --- seeding ---

    private async Task SeedUsersAsync()
    {
        await TestDb.SaveAsync(_db,
            new User
            {
                Id = _staffId, Username = "ana", PasswordHash = "x", FirstName = "Ana", LastName = "Reyes",
                IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = _staffId
            },
            new User
            {
                Id = _systemUserId, Username = SubmitPublicOrderHandler.SystemUsername, PasswordHash = "x",
                FirstName = "Customer", LastName = "Link", IsActive = false, RoleId = 2, CreatedAt = DateTime.UtcNow,
                CreatedBy = _staffId
            });
    }

    private async Task<Customer> AddCustomerAsync(string first = "Maria")
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(), FirstName = first, LastName = "Cruz", IsActive = true, AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, customer);
        return customer;
    }

    private async Task<ShortLink> AddLinkAsync(Guid customerId, DateTime? revokedAt = null)
    {
        var link = new ShortLink
        {
            Id = Guid.NewGuid(), Token = OrderLinkToken.Generate(), TargetType = OrderLinkToken.TargetType,
            TargetId = customerId, RevokedAt = revokedAt, CreatedAt = DateTime.UtcNow.AddHours(-1), CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, link);
        return link;
    }

    private async Task<Order> AddOrderAsync(Guid? customerId, OrderStatusEnum status = OrderStatusEnum.Pending,
        OrderSourceEnum source = OrderSourceEnum.CustomerLink, int number = 1042)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(), OrderNumber = number, CustomerId = customerId, Source = (byte)source,
            StatusId = (int)status, CreatedAt = DateTime.UtcNow, CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, order);
        return order;
    }

    private async Task<Conversation> AddConversationAsync(Order order, Guid customerId)
    {
        var conversation = new Conversation
        {
            Id = Guid.NewGuid(), CustomerId = customerId, Kind = (byte)ConversationKind.Order, OrderId = order.Id,
            Title = ConversationRules.OrderTitle(order.OrderNumber), CreatedAt = DateTime.UtcNow,
            LastMessageAt = DateTime.UtcNow
        };
        await TestDb.SaveAsync(_db, conversation);
        return conversation;
    }

    private async Task AddMessageAsync(Conversation conversation, MessageSender sender, string body,
        DateTime? at = null, bool read = false)
    {
        var when = at ?? DateTime.UtcNow;
        await TestDb.SaveAsync(_db, new ConversationMessage
        {
            Id = Guid.NewGuid(), ConversationId = conversation.Id, SenderType = (byte)sender,
            SenderUserId = sender == MessageSender.Staff ? _staffId : null, Body = body, CreatedAt = when,
            ReadByStaffAt = sender == MessageSender.Staff || read ? when : null,
            ReadByCustomerAt = sender == MessageSender.Customer || read ? when : null
        });

        await using var db = TestDb.Create(_db);
        // A conversation is as new as its newest message.
        var row = await db.Conversations.SingleAsync(c => c.Id == conversation.Id);
        row.LastMessageAt = await db.ConversationMessages
            .Where(m => m.ConversationId == conversation.Id)
            .MaxAsync(m => m.CreatedAt);
        await db.SaveChangesAsync();
    }

    private async Task<(Customer Customer, ShortLink Link, Order Order)> SeedChatAsync(
        OrderStatusEnum status = OrderStatusEnum.Pending)
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);
        var order = await AddOrderAsync(customer.Id, status);
        return (customer, link, order);
    }

    private async Task<List<ConversationMessage>> MessagesAsync()
    {
        await using var db = TestDb.Create(_db);
        return await db.ConversationMessages.OrderBy(m => m.CreatedAt).ToListAsync();
    }

    // === staff: sending ===

    [Fact]
    public async Task StaffSend_FirstMessage_StartsTheChatTitledWithTheOrderNumber_AndTellsTheOtherSide()
    {
        var (customer, _, order) = await SeedChatAsync();

        var dto = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "  Ready at 5pm  "), default);

        dto.ShouldNotBeNull();
        dto.Sender.ShouldBe("staff");
        dto.SenderName.ShouldBe("Ana Reyes");
        dto.Body.ShouldBe("Ready at 5pm");

        await using var db = TestDb.Create(_db);
        var conversation = await db.Conversations.SingleAsync();
        conversation.Title.ShouldBe("Order #1042");
        conversation.OrderId.ShouldBe(order.Id);
        conversation.CustomerId.ShouldBe(customer.Id);
        conversation.Kind.ShouldBe((byte)ConversationKind.Order);
        var message = await db.ConversationMessages.SingleAsync();
        message.SenderUserId.ShouldBe(_staffId);
        message.ReadByStaffAt.ShouldNotBeNull("a staff member's own message is read by the staff");
        message.ReadByCustomerAt.ShouldBeNull();

        await _audit.Received(1).LogAsync(
            AuditAction.ConversationStarted, AuditEntityType.Conversation, conversation.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _staffId, Arg.Any<CancellationToken>());
        await _notifier.Received(1).MessageSentAsync(
            Arg.Any<Order>(), Arg.Any<Conversation>(), Arg.Any<ConversationMessage>(), Arg.Any<string?>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StaffSend_SecondMessage_UsesTheSameChat_AndIsNotAuditedAsANewOne()
    {
        var (_, _, order) = await SeedChatAsync();

        await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "one"), default);
        await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "two"), default);

        await using var db = TestDb.Create(_db);
        (await db.Conversations.CountAsync()).ShouldBe(1);
        (await db.ConversationMessages.CountAsync()).ShouldBe(2);
        await _audit.Received(1).LogAsync(
            AuditAction.ConversationStarted, Arg.Any<AuditEntityType>(), Arg.Any<string>(), Arg.Any<object?>(),
            Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StaffSend_AWaitingOrderCanBeAskedAbout()
    {
        var (_, _, order) = await SeedChatAsync(OrderStatusEnum.PendingApproval);

        var dto = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "Is 5pm ok?"), default);

        dto.ShouldNotBeNull();
    }

    [Fact]
    public async Task StaffSend_UnknownOrder_ReturnsNull()
    {
        (await StaffSend().Handle(new SendStaffMessageCommand(Guid.NewGuid(), "hi"), default)).ShouldBeNull();
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task StaffSend_AnOrderTheShopTookItself_IsRefused()
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        var order = await AddOrderAsync(customer.Id, source: OrderSourceEnum.Pos);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            StaffSend().Handle(new SendStaffMessageCommand(order.Id, "hi"), default));

        ex.Message.ShouldBe("Chat is only for orders placed through a customer link.");
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task StaffSend_AFinishedOrder_IsRefused(OrderStatusEnum status)
    {
        var (_, _, order) = await SeedChatAsync(status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            StaffSend().Handle(new SendStaffMessageCommand(order.Id, "hi"), default));

        ex.Message.ShouldBe(ConversationRules.ClosedOrderMessage);
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n  ")]
    public async Task StaffSend_AnEmptyMessage_IsRefused(string? body)
    {
        var (_, _, order) = await SeedChatAsync();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            StaffSend().Handle(new SendStaffMessageCommand(order.Id, body!), default));

        ex.Message.ShouldBe("A message cannot be empty.");
    }

    [Fact]
    public async Task StaffSend_TooLong_IsRefused_AndExactlyTheLimitIsAccepted()
    {
        var (_, _, order) = await SeedChatAsync();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            StaffSend().Handle(new SendStaffMessageCommand(order.Id, new string('x', 1001)), default));
        var ok = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, new string('x', 1000)), default);

        ok.ShouldNotBeNull();
        (await MessagesAsync()).Count.ShouldBe(1);
    }

    [Fact]
    public async Task StaffSend_KeepsTextAsPlainText_NeverHtml()
    {
        var (_, _, order) = await SeedChatAsync();

        var dto = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "<script>alert(1)</script>"), default);

        dto!.Body.ShouldBe("<script>alert(1)</script>");
    }

    [Fact]
    public async Task StaffSend_AnsweringMarksTheCustomersEarlierMessagesRead()
    {
        var (customer, _, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "Are you open?", DateTime.UtcNow.AddMinutes(-5));
        await AddMessageAsync(conversation, MessageSender.Customer, "Hello?", DateTime.UtcNow.AddMinutes(-4));

        await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "Yes!"), default);

        var customerMessages = (await MessagesAsync()).Where(m => m.SenderType == (byte)MessageSender.Customer);
        customerMessages.ShouldAllBe(m => m.ReadByStaffAt != null);
    }

    // === staff: reading ===

    [Fact]
    public async Task StaffGet_NoChatYet_IsEmptyButOpenForAnAcceptedOrder()
    {
        var (_, _, order) = await SeedChatAsync();

        var dto = await StaffGet().Handle(new GetOrderConversationQuery(order.Id), default);

        dto.ShouldNotBeNull();
        dto.ConversationId.ShouldBeNull();
        dto.Title.ShouldBe("Order #1042");
        dto.CanSend.ShouldBeTrue();
        dto.ClosedReason.ShouldBeNull();
        dto.Messages.ShouldBeEmpty();
        dto.UnreadCount.ShouldBe(0);
    }

    [Fact]
    public async Task StaffGet_ListsMessagesOldestFirst_WithStaffFullNames_AndTheUnreadCount()
    {
        var (customer, _, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "first", DateTime.UtcNow.AddMinutes(-30));
        await AddMessageAsync(conversation, MessageSender.Staff, "second", DateTime.UtcNow.AddMinutes(-20));
        await AddMessageAsync(conversation, MessageSender.Customer, "third", DateTime.UtcNow.AddMinutes(-10));
        await AddMessageAsync(conversation, MessageSender.Customer, "fourth", DateTime.UtcNow.AddMinutes(-5));

        var dto = await StaffGet().Handle(new GetOrderConversationQuery(order.Id), default);

        dto!.Messages.Select(m => m.Body).ShouldBe(["first", "second", "third", "fourth"]);
        dto.Messages[1].Sender.ShouldBe("staff");
        dto.Messages[1].SenderName.ShouldBe("Ana Reyes");
        dto.Messages[0].Sender.ShouldBe("customer");
        dto.Messages[0].SenderName.ShouldBeNull();
        dto.UnreadCount.ShouldBe(3, "the customer's messages that no staff member has opened");
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    public async Task StaffGet_AFinishedOrder_IsReadOnlyHistory(OrderStatusEnum status)
    {
        var (customer, _, order) = await SeedChatAsync(status);
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "thanks");

        var dto = await StaffGet().Handle(new GetOrderConversationQuery(order.Id), default);

        dto!.CanSend.ShouldBeFalse();
        dto.ClosedReason.ShouldBe(ConversationRules.ClosedOrderMessage);
        dto.Messages.Count.ShouldBe(1);
    }

    [Fact]
    public async Task StaffGet_UnknownOrAShopOrder_ReturnsNull()
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        var shopOrder = await AddOrderAsync(customer.Id, source: OrderSourceEnum.Pos, number: 7);

        (await StaffGet().Handle(new GetOrderConversationQuery(Guid.NewGuid()), default)).ShouldBeNull();
        (await StaffGet().Handle(new GetOrderConversationQuery(shopOrder.Id), default)).ShouldBeNull();
    }

    // === staff: marking read ===

    [Fact]
    public async Task StaffRead_MarksTheCustomersMessagesRead_AndTellsTheOtherStaff()
    {
        var (customer, _, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "one");
        await AddMessageAsync(conversation, MessageSender.Customer, "two");

        var ok = await StaffRead().Handle(new MarkOrderConversationReadCommand(order.Id), default);

        ok.ShouldBeTrue();
        (await MessagesAsync()).ShouldAllBe(m => m.ReadByStaffAt != null);
        await _notifier.Received(1).ConversationReadAsync(
            Arg.Any<Order>(), Arg.Any<Conversation>(), MessageSender.Staff, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StaffRead_WhenNothingIsUnread_SaysNothing()
    {
        var (customer, _, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "one", read: true);

        (await StaffRead().Handle(new MarkOrderConversationReadCommand(order.Id), default)).ShouldBeTrue();

        await _notifier.DidNotReceiveWithAnyArgs().ConversationReadAsync(default!, default!, default, default);
    }

    [Fact]
    public async Task StaffRead_NoChatYet_IsFine_AndUnknownOrderIsNotFound()
    {
        var (_, _, order) = await SeedChatAsync();

        (await StaffRead().Handle(new MarkOrderConversationReadCommand(order.Id), default)).ShouldBeTrue();
        (await StaffRead().Handle(new MarkOrderConversationReadCommand(Guid.NewGuid()), default)).ShouldBeFalse();
    }

    // === staff: the envelope list ===

    [Fact]
    public async Task StaffList_PutsUnreadFirst_ThenNewest_AndCountsConversationsNotMessages()
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        var quietOld = await AddOrderAsync(customer.Id, number: 1);
        var unreadOld = await AddOrderAsync(customer.Id, number: 2);
        var quietNew = await AddOrderAsync(customer.Id, number: 3);
        var unreadNew = await AddOrderAsync(customer.Id, number: 4);
        var c1 = await AddConversationAsync(quietOld, customer.Id);
        var c2 = await AddConversationAsync(unreadOld, customer.Id);
        var c3 = await AddConversationAsync(quietNew, customer.Id);
        var c4 = await AddConversationAsync(unreadNew, customer.Id);
        await AddMessageAsync(c1, MessageSender.Customer, "old quiet", DateTime.UtcNow.AddHours(-9), read: true);
        await AddMessageAsync(c2, MessageSender.Customer, "old unread a", DateTime.UtcNow.AddHours(-8));
        await AddMessageAsync(c2, MessageSender.Customer, "old unread b", DateTime.UtcNow.AddHours(-7));
        await AddMessageAsync(c3, MessageSender.Customer, "new quiet", DateTime.UtcNow.AddHours(-1), read: true);
        await AddMessageAsync(c4, MessageSender.Customer, "new unread", DateTime.UtcNow.AddMinutes(-5));

        var list = await StaffList().Handle(new GetConversationsQuery(), default);

        list.UnreadConversations.ShouldBe(2);
        list.Items.Select(i => i.OrderNumber).ShouldBe([4, 2, 3, 1]);
        list.Items[0].UnreadCount.ShouldBe(1);
        list.Items[1].UnreadCount.ShouldBe(2);
        list.Items[0].Title.ShouldBe("Order #4");
        list.Items[0].CustomerName.ShouldBe("Maria Cruz");
        list.Items[0].LastMessage.ShouldBe("new unread");
        list.Items[0].LastSender.ShouldBe("customer");
    }

    [Fact]
    public async Task StaffList_ShowsTheLastMessageFromWhoeverWroteIt_AndAShortPreview()
    {
        var (customer, _, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "question", DateTime.UtcNow.AddMinutes(-10), read: true);
        await AddMessageAsync(conversation, MessageSender.Staff, new string('y', 300), DateTime.UtcNow.AddMinutes(-5));

        var item = (await StaffList().Handle(new GetConversationsQuery(), default)).Items.Single();

        item.LastSender.ShouldBe("staff");
        item.LastMessage.Length.ShouldBeLessThanOrEqualTo(80);
        item.UnreadCount.ShouldBe(0, "a reply from the shop is not unread for the staff");
    }

    [Fact]
    public async Task StaffList_NothingYet_IsEmpty()
    {
        var list = await StaffList().Handle(new GetConversationsQuery(), default);

        list.UnreadConversations.ShouldBe(0);
        list.Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task StaffList_IsLimitedToTheNewestThirty()
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        for (var i = 0; i < 35; i++)
        {
            var order = await AddOrderAsync(customer.Id, number: 100 + i);
            var conversation = await AddConversationAsync(order, customer.Id);
            await AddMessageAsync(conversation, MessageSender.Customer, "hi", DateTime.UtcNow.AddMinutes(-i), read: true);
        }

        var list = await StaffList().Handle(new GetConversationsQuery(), default);

        list.Items.Count.ShouldBe(ConversationRules.MaxListItems);
        list.Items[0].OrderNumber.ShouldBe(100);
    }

    // === customer: sending ===

    [Fact]
    public async Task PublicSend_StartsTheChat_SavesAsTheCustomer_AndTellsStaff()
    {
        var (customer, link, order) = await SeedChatAsync(OrderStatusEnum.PendingApproval);

        var dto = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "Is 5pm ok?"), default);

        dto.ShouldNotBeNull();
        dto.Sender.ShouldBe("customer");
        dto.SenderName.ShouldBeNull();
        var message = (await MessagesAsync()).Single();
        message.SenderType.ShouldBe((byte)MessageSender.Customer);
        message.SenderUserId.ShouldBeNull();
        message.ReadByCustomerAt.ShouldNotBeNull();
        message.ReadByStaffAt.ShouldBeNull();

        await using var db = TestDb.Create(_db);
        var conversation = await db.Conversations.SingleAsync();
        conversation.CustomerId.ShouldBe(customer.Id);
        conversation.Title.ShouldBe("Order #1042");

        await _notifier.Received(1).MessageSentAsync(
            Arg.Any<Order>(), Arg.Any<Conversation>(), Arg.Any<ConversationMessage>(), "Maria Cruz",
            Arg.Any<CancellationToken>());
        await _audit.Received(1).LogAsync(
            AuditAction.ConversationStarted, AuditEntityType.Conversation, conversation.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _systemUserId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task PublicSend_AnUnknownRevokedOrExpiredLink_ReturnsNull_AndSavesNothing()
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        var revoked = await AddLinkAsync(customer.Id, revokedAt: DateTime.UtcNow.AddMinutes(-1));
        var order = await AddOrderAsync(customer.Id);

        (await PublicSend().Handle(new SendPublicMessageCommand("nope", order.Id, "hi"), default)).ShouldBeNull();
        (await PublicSend().Handle(new SendPublicMessageCommand(revoked.Token, order.Id, "hi"), default)).ShouldBeNull();
        (await MessagesAsync()).ShouldBeEmpty();
        await _notifier.DidNotReceiveWithAnyArgs().MessageSentAsync(default!, default!, default!, default, default);
    }

    [Fact]
    public async Task PublicSend_ACustomerCannotWriteAboutSomeoneElsesOrder_OrAShopOrder()
    {
        var (_, link, _) = await SeedChatAsync();
        var other = await AddCustomerAsync("Ben");
        var othersOrder = await AddOrderAsync(other.Id, number: 2000);
        var shopOrder = await AddOrderAsync((await AddCustomerAsync("Cara")).Id, source: OrderSourceEnum.Pos, number: 3000);

        (await PublicSend().Handle(new SendPublicMessageCommand(link.Token, othersOrder.Id, "hi"), default)).ShouldBeNull();
        (await PublicSend().Handle(new SendPublicMessageCommand(link.Token, shopOrder.Id, "hi"), default)).ShouldBeNull();
        (await PublicSend().Handle(new SendPublicMessageCommand(link.Token, Guid.NewGuid(), "hi"), default)).ShouldBeNull();
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task PublicSend_AFinishedOrder_IsRefused(OrderStatusEnum status)
    {
        var (_, link, order) = await SeedChatAsync(status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "hi"), default));

        ex.Message.ShouldBe(ConversationRules.ClosedOrderMessage);
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task PublicSend_AnEmptyOrTooLongMessage_IsRefused(string body)
    {
        var (_, link, order) = await SeedChatAsync();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, body), default));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, new string('x', 1001)), default));
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task PublicSend_Flooding_StopsAfterTenUnansweredMessages_AndAReplyLetsThemContinue()
    {
        var (customer, link, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        for (var i = 0; i < ConversationRules.MaxUnansweredCustomerMessages; i++)
        {
            await AddMessageAsync(conversation, MessageSender.Customer, $"m{i}", DateTime.UtcNow.AddMinutes(-30 + i));
        }

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "again"), default));
        ex.Message.ShouldBe("Please wait for the shop to reply before sending more messages.");

        await AddMessageAsync(conversation, MessageSender.Staff, "We are here", DateTime.UtcNow.AddMinutes(-1));
        var ok = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "thanks"), default);

        ok.ShouldNotBeNull();
    }

    // === customer: reading ===

    [Fact]
    public async Task PublicGet_ShowsTheChat_WithStaffByFirstNameOnly_AndTheUnreadCount()
    {
        var (customer, link, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Customer, "question", DateTime.UtcNow.AddMinutes(-10));
        await AddMessageAsync(conversation, MessageSender.Staff, "answer", DateTime.UtcNow.AddMinutes(-5));

        var dto = await PublicGet().Handle(new GetPublicOrderConversationQuery(link.Token, order.Id), default);

        dto.ShouldNotBeNull();
        dto.Messages.Select(m => m.Body).ShouldBe(["question", "answer"]);
        dto.Messages[1].SenderName.ShouldBe("Ana", "a customer is told a staff member's first name, not their account");
        dto.UnreadCount.ShouldBe(1, "the shop's reply the customer has not seen");
        dto.CanSend.ShouldBeTrue();
    }

    [Fact]
    public async Task PublicGet_ARevokedLink_OrSomeoneElsesOrder_IsNotFound()
    {
        var (customer, link, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Staff, "hi");
        var other = await AddCustomerAsync("Ben");
        var otherLink = await AddLinkAsync(other.Id);

        (await PublicGet().Handle(new GetPublicOrderConversationQuery("nope", order.Id), default)).ShouldBeNull();
        (await PublicGet().Handle(new GetPublicOrderConversationQuery(otherLink.Token, order.Id), default)).ShouldBeNull();

        await using (var db = TestDb.Create(_db))
        {
            (await db.ShortLinks.SingleAsync(l => l.Id == link.Id)).RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        (await PublicGet().Handle(new GetPublicOrderConversationQuery(link.Token, order.Id), default)).ShouldBeNull();
    }

    [Fact]
    public async Task PublicGet_AFinishedOrder_IsReadOnlyHistory()
    {
        var (customer, link, order) = await SeedChatAsync(OrderStatusEnum.Completed);
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Staff, "thank you");

        var dto = await PublicGet().Handle(new GetPublicOrderConversationQuery(link.Token, order.Id), default);

        dto!.CanSend.ShouldBeFalse();
        dto.ClosedReason.ShouldBe(ConversationRules.ClosedOrderMessage);
        dto.Messages.Count.ShouldBe(1);
    }

    [Fact]
    public async Task PublicList_ShowsOnlyThisCustomersChats_WithTheShopsUnreadRepliesFirst()
    {
        await SeedUsersAsync();
        var customer = await AddCustomerAsync();
        var link = await AddLinkAsync(customer.Id);
        var other = await AddCustomerAsync("Ben");
        var read = await AddOrderAsync(customer.Id, number: 1);
        var unread = await AddOrderAsync(customer.Id, number: 2);
        var theirs = await AddOrderAsync(other.Id, number: 3);
        var c1 = await AddConversationAsync(read, customer.Id);
        var c2 = await AddConversationAsync(unread, customer.Id);
        var c3 = await AddConversationAsync(theirs, other.Id);
        await AddMessageAsync(c1, MessageSender.Staff, "seen", DateTime.UtcNow.AddMinutes(-1), read: true);
        await AddMessageAsync(c2, MessageSender.Staff, "new reply", DateTime.UtcNow.AddHours(-3));
        await AddMessageAsync(c3, MessageSender.Staff, "someone else", DateTime.UtcNow);

        var list = await PublicList().Handle(new GetPublicConversationsQuery(link.Token), default);

        list.ShouldNotBeNull();
        list.UnreadConversations.ShouldBe(1);
        list.Items.Select(i => i.OrderNumber).ShouldBe([2, 1]);
        list.Items.ShouldAllBe(i => i.CustomerName == null, "a customer does not need their own name in their list");
    }

    [Fact]
    public async Task PublicList_AnInvalidLink_IsNotFound()
    {
        await SeedUsersAsync();

        (await PublicList().Handle(new GetPublicConversationsQuery("nope"), default)).ShouldBeNull();
    }

    // === customer: marking read ===

    [Fact]
    public async Task PublicRead_MarksTheShopsRepliesRead_AndTellsTheOtherScreens()
    {
        var (customer, link, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Staff, "a");
        await AddMessageAsync(conversation, MessageSender.Staff, "b");

        var ok = await PublicRead().Handle(new MarkPublicConversationReadCommand(link.Token, order.Id), default);

        ok.ShouldBeTrue();
        (await MessagesAsync()).ShouldAllBe(m => m.ReadByCustomerAt != null);
        await _notifier.Received(1).ConversationReadAsync(
            Arg.Any<Order>(), Arg.Any<Conversation>(), MessageSender.Customer, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task PublicRead_AnotherCustomersOrder_OrABadLink_IsNotFound()
    {
        var (customer, link, order) = await SeedChatAsync();
        var conversation = await AddConversationAsync(order, customer.Id);
        await AddMessageAsync(conversation, MessageSender.Staff, "a");
        var other = await AddCustomerAsync("Ben");
        var otherLink = await AddLinkAsync(other.Id);

        (await PublicRead().Handle(new MarkPublicConversationReadCommand(otherLink.Token, order.Id), default)).ShouldBeFalse();
        (await PublicRead().Handle(new MarkPublicConversationReadCommand("nope", order.Id), default)).ShouldBeFalse();
        (await MessagesAsync()).ShouldAllBe(m => m.ReadByCustomerAt == null);
    }

    // === rules ===

    [Theory]
    [InlineData(OrderStatusEnum.PendingApproval, OrderSourceEnum.CustomerLink, true)]
    [InlineData(OrderStatusEnum.Pending, OrderSourceEnum.CustomerLink, true)]
    [InlineData(OrderStatusEnum.Completed, OrderSourceEnum.CustomerLink, false)]
    [InlineData(OrderStatusEnum.Cancelled, OrderSourceEnum.CustomerLink, false)]
    [InlineData(OrderStatusEnum.Refunded, OrderSourceEnum.CustomerLink, false)]
    [InlineData(OrderStatusEnum.Pending, OrderSourceEnum.Pos, false)]
    public void IsChatOpen_OnlyForLinkOrdersThatAreWaitingOrAccepted(
        OrderStatusEnum status, OrderSourceEnum source, bool expected)
    {
        var order = new Order { StatusId = (int)status, Source = (byte)source };

        ConversationRules.IsChatOpen(order).ShouldBe(expected);
        (ConversationRules.ClosedReason(order) is null).ShouldBe(expected);
    }

    [Fact]
    public void NormalizeBody_TrimsAndKeepsLineBreaks()
    {
        ConversationRules.NormalizeBody("  hello\r\nworld  ").ShouldBe("hello\nworld");
    }

    [Fact]
    public void Preview_IsShort_AndOnOneLine()
    {
        ConversationRules.Preview("a\nb").ShouldBe("a b");
        ConversationRules.Preview(new string('z', 200)).Length.ShouldBe(80);
        ConversationRules.Preview("short").ShouldBe("short");
    }
}
