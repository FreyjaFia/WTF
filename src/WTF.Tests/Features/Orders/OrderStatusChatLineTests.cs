using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

/// <summary>Paying, cancelling and refunding an order write a line into its chat and tell open screens, like accepting does.</summary>
public class OrderStatusChatLineTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly OrderSeed _data = new(TestDb.NewName());
    private readonly IConversationNotifier _conversations = TestFakes.Conversations();

    private UpdateOrderHandler Update() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), _conversations);

    private VoidOrderHandler Void() =>
        new(_data.Open(), TestRequest.As(_userId, AppRoles.Admin), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), _conversations);

    private (Guid OrderId, Guid ProductId, Guid CustomerId) AddOrder(
        OrderStatusEnum status = OrderStatusEnum.Pending, OrderSourceEnum source = OrderSourceEnum.CustomerLink)
    {
        var customer = _data.AddCustomer("Maria", "Cruz");
        var burger = _data.AddProduct("Burger", 100);
        var id = _data.AddOrder(status, customer);
        _data.AddLine(id, burger, 1);
        using var db = _data.Open();
        db.Orders.Single(o => o.Id == id).Source = (byte)source;
        db.SaveChanges();
        return (id, burger, customer);
    }

    private UpdateOrderCommand Command(Guid id, Guid customerId, Guid productId, OrderStatusEnum status) => new()
    {
        Id = id,
        CustomerId = customerId,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null)],
        Status = status,
        PaymentMethod = status == OrderStatusEnum.Completed ? PaymentMethodEnum.Cash : null,
        AmountReceived = status == OrderStatusEnum.Completed ? 100 : null,
    };

    private async Task<List<string>> LinesAsync(Guid orderId)
    {
        await using var db = _data.Open();
        return await db.ConversationMessages
            .Where(m => m.Conversation.OrderId == orderId && m.SenderType == (byte)MessageSender.System)
            .OrderBy(m => m.CreatedAt)
            .Select(m => m.Body)
            .ToListAsync();
    }

    [Fact]
    public async Task Paying_WritesACompletedLine_AndTellsOpenChats()
    {
        var (id, product, customer) = AddOrder();

        await Update().Handle(Command(id, customer, product, OrderStatusEnum.Completed), CancellationToken.None);

        (await LinesAsync(id)).ShouldBe(["Order completed"]);
        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == id),
            Arg.Is<WTF.Domain.Entities.Conversation?>(c => c != null), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task EditingAnOrderWithoutChangingItsStatus_WritesNoLine_ButStillRefreshesScreens()
    {
        var (id, product, customer) = AddOrder();

        await Update().Handle(Command(id, customer, product, OrderStatusEnum.Pending), CancellationToken.None);

        (await LinesAsync(id)).ShouldBeEmpty();
        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == id), null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Paying_AnOrderTheShopTookItself_StartsNoChat()
    {
        var (id, product, customer) = AddOrder(source: OrderSourceEnum.Pos);

        await Update().Handle(Command(id, customer, product, OrderStatusEnum.Completed), CancellationToken.None);

        (await LinesAsync(id)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Cancelling_WritesACancelledLine()
    {
        var (id, _, _) = AddOrder();

        await Void().Handle(new VoidOrderCommand(id), CancellationToken.None);

        (await LinesAsync(id)).ShouldBe(["Order cancelled"]);
        await _conversations.Received(1).OrderChangedAsync(
            Arg.Is<WTF.Domain.Entities.Order>(o => o.Id == id),
            Arg.Is<WTF.Domain.Entities.Conversation?>(c => c != null), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Refunding_WritesARefundedLine()
    {
        var (id, _, _) = AddOrder(OrderStatusEnum.Completed);

        await Void().Handle(new VoidOrderCommand(id, "Wrong order"), CancellationToken.None);

        (await LinesAsync(id)).ShouldBe(["Order refunded"]);
    }

    [Fact]
    public async Task TheLineIsShownToBothSides_NamingTheStaffMemberToStaffOnly()
    {
        var (id, product, customer) = AddOrder();
        await using (var seed = _data.Open())
        {
            seed.Users.Add(new WTF.Domain.Entities.User
            {
                Id = _userId, Username = "ana", PasswordHash = "x", FirstName = "Ana", LastName = "Reyes",
                IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = _userId
            });
            await seed.SaveChangesAsync();
        }

        await Update().Handle(Command(id, customer, product, OrderStatusEnum.Completed), CancellationToken.None);

        await using var db = _data.Open();
        var conversationId = (await db.Conversations.SingleAsync(c => c.OrderId == id)).Id;
        var forStaff = await ConversationStore.LoadMessagesAsync(db, conversationId, forCustomer: false, default);
        var forCustomer = await ConversationStore.LoadMessagesAsync(db, conversationId, forCustomer: true, default);

        forStaff.ShouldHaveSingleItem().Sender.ShouldBe("system");
        forStaff[0].SenderName.ShouldBe("Ana Reyes");
        forCustomer.ShouldHaveSingleItem().Sender.ShouldBe("system");
        forCustomer[0].SenderName.ShouldBeNull("the customer is never told which staff member made the change");
    }
}
