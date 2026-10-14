using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Conversations;

/// <summary>
/// A system line ("Order accepted") is the shop speaking. Staff see which staff member made the change; the customer
/// is never told a staff member's name, not even a first name.
/// </summary>
public class ChatSystemLineTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();

    private async Task<(ShortLink Link, Order Order)> SeedAsync()
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = customer.Id,
            CreatedAt = DateTime.UtcNow.AddHours(-1),
            CreatedBy = _staffId
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = 1042,
            CustomerId = customer.Id,
            Source = (byte)OrderSourceEnum.CustomerLink,
            StatusId = (int)OrderStatusEnum.Pending,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var conversation = new Conversation
        {
            Id = Guid.NewGuid(),
            CustomerId = customer.Id,
            Kind = (byte)ConversationKind.Order,
            OrderId = order.Id,
            Title = "Order #1042",
            CreatedAt = DateTime.UtcNow,
            LastMessageAt = DateTime.UtcNow
        };
        await TestDb.SaveAsync(_db,
            new User
            {
                Id = _staffId,
                Username = "ana",
                PasswordHash = "x",
                FirstName = "Ana",
                LastName = "Reyes",
                IsActive = true,
                RoleId = 2,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _staffId
            },
            customer, link, order, conversation,
            new ConversationMessage
            {
                Id = Guid.NewGuid(),
                ConversationId = conversation.Id,
                SenderType = (byte)MessageSender.System,
                SenderUserId = _staffId,
                Body = "Order accepted",
                CreatedAt = DateTime.UtcNow.AddMinutes(-2)
            },
            new ConversationMessage
            {
                Id = Guid.NewGuid(),
                ConversationId = conversation.Id,
                SenderType = (byte)MessageSender.Staff,
                SenderUserId = _staffId,
                Body = "Ready at 5",
                CreatedAt = DateTime.UtcNow.AddMinutes(-1)
            });
        return (link, order);
    }

    [Fact]
    public async Task TheCustomerSeesNoStaffNameOnASystemLine_OnlyTheShopsOwnRepliesCarryAFirstName()
    {
        var (link, order) = await SeedAsync();

        var chat = await new GetPublicOrderConversationHandler(TestDb.Create(_db))
            .Handle(new GetPublicOrderConversationQuery(link.Token, order.Id), default);

        var system = chat!.Messages.Single(m => m.Sender == "system");
        system.Body.ShouldBe("Order accepted");
        system.SenderName.ShouldBeNull();
        chat.Messages.Single(m => m.Sender == "staff").SenderName.ShouldBe("Ana");
    }

    [Fact]
    public async Task StaffStillSeeWhoMadeTheChange()
    {
        var (_, order) = await SeedAsync();

        var chat = await new GetOrderConversationHandler(TestDb.Create(_db)).Handle(new GetOrderConversationQuery(order.Id), default);

        chat!.Messages.Single(m => m.Sender == "system").SenderName.ShouldBe("Ana Reyes");
    }

    [Fact]
    public async Task AFreshlyBuiltSystemLineIsAlsoNamelessForTheCustomer()
    {
        await SeedAsync();
        await using var db = TestDb.Create(_db);
        var message = await db.ConversationMessages.FirstAsync(m => m.SenderType == (byte)MessageSender.System);

        ConversationStore.ToDto(message, "Ana", "Reyes", forCustomer: true).SenderName.ShouldBeNull();
        ConversationStore.ToDto(message, "Ana", "Reyes", forCustomer: false).SenderName.ShouldBe("Ana Reyes");
    }
}
