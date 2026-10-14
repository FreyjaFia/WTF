using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>
/// Order chat against a real SQL Server: the list query (unread first, counts and last message in one round trip), the
/// foreign keys, and the rule that an order has at most one conversation.
/// </summary>
public class ConversationDatabaseTests
{
    private sealed record Setup(SqlTestDatabase Database, User Staff, Customer Customer, ShortLink Link, Order Order);

    private static async Task<Setup> SeedAsync(SqlTestDatabase database,
        OrderStatusEnum status = OrderStatusEnum.Pending, int number = 1042)
    {
        var staff = await SqlSeed.UserAsync(database, "cashier", roleId: 2);
        await SqlSeed.UserAsync(database, SubmitPublicOrderHandler.SystemUsername, roleId: 2, active: false);

        await using var db = database.CreateContext();
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = staff.Id
        };
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = customer.Id,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = staff.Id
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = number,
            CustomerId = customer.Id,
            Source = (byte)OrderSourceEnum.CustomerLink,
            StatusId = (int)status,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = staff.Id
        };
        db.Customers.Add(customer);
        db.ShortLinks.Add(link);
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return new Setup(database, staff, customer, link, order);
    }

    private static IConversationNotifier Notifier() => Substitute.For<IConversationNotifier>();

    [SqlFact]
    public async Task AFullChat_CustomerAsks_StaffSeesItUnread_RepliesAndTheCustomerReadsIt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var s = await SeedAsync(database);

        await using (var db = database.CreateContext())
        {
            var sent = await new SendPublicMessageHandler(db, TestFakes.Audit(), Notifier(), TimeProvider.System)
                .Handle(new SendPublicMessageCommand(s.Link.Token, s.Order.Id, "Is 5pm ok?"), default);
            sent.ShouldNotBeNull();
        }

        await using (var db = database.CreateContext())
        {
            var list = await new GetConversationsHandler(db).Handle(new GetConversationsQuery(), default);
            list.UnreadConversations.ShouldBe(1);
            var item = list.Items.ShouldHaveSingleItem();
            item.Title.ShouldBe("Order #1042");
            item.CustomerName.ShouldBe("Maria Cruz");
            item.LastMessage.ShouldBe("Is 5pm ok?");
            item.LastSender.ShouldBe("customer");
            item.UnreadCount.ShouldBe(1);
        }

        await using (var db = database.CreateContext())
        {
            var reply = await new SendStaffMessageHandler(db, TestRequest.As(s.Staff.Id, AppRoles.Cashier), TestFakes.Audit(), Notifier())
                .Handle(new SendStaffMessageCommand(s.Order.Id, "Yes, ready at 5"), default);
            reply!.SenderName.ShouldBe("Al Em");
        }

        await using (var db = database.CreateContext())
        {
            var staffView = await new GetOrderConversationHandler(db).Handle(new GetOrderConversationQuery(s.Order.Id), default);
            staffView!.Messages.Select(m => m.Body).ShouldBe(["Is 5pm ok?", "Yes, ready at 5"]);
            staffView.UnreadCount.ShouldBe(0, "answering reads the customer's message");
        }

        await using (var db = database.CreateContext())
        {
            var customerView = await new GetPublicOrderConversationHandler(db)
                .Handle(new GetPublicOrderConversationQuery(s.Link.Token, s.Order.Id), default);
            customerView!.UnreadCount.ShouldBe(1);
            customerView.Messages[1].SenderName.ShouldBe("Al", "the customer sees the first name only");
        }

        await using (var db = database.CreateContext())
        {
            (await new MarkPublicConversationReadHandler(db, TimeProvider.System, Notifier())
                .Handle(new MarkPublicConversationReadCommand(s.Link.Token, s.Order.Id), default)).ShouldBeTrue();
        }

        await using (var db = database.CreateContext())
        {
            var list = await new GetPublicConversationsHandler(db).Handle(new GetPublicConversationsQuery(s.Link.Token), default);
            list!.UnreadConversations.ShouldBe(0);
            list.Items.ShouldHaveSingleItem().LastSender.ShouldBe("staff");
        }
    }

    [SqlFact]
    public async Task TheStaffList_PutsUnreadFirst_AndCountsOnlyConversationsWithSomethingUnread()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var first = await SeedAsync(database, number: 1);

        // Two more orders for the same customer.
        var orders = new List<Order>();
        await using (var db = database.CreateContext())
        {
            for (var i = 2; i <= 3; i++)
            {
                var order = new Order
                {
                    Id = Guid.NewGuid(),
                    OrderNumber = i,
                    CustomerId = first.Customer.Id,
                    Source = (byte)OrderSourceEnum.CustomerLink,
                    StatusId = (int)OrderStatusEnum.Pending,
                    CreatedAt = DateTime.UtcNow,
                    CreatedBy = first.Staff.Id
                };
                orders.Add(order);
                db.Orders.Add(order);
            }

            await db.SaveChangesAsync();
        }

        // Order 1: a read message (newest). Order 2: an unread message (older). Order 3: nothing.
        await using (var db = database.CreateContext())
        {
            await new SendPublicMessageHandler(db, TestFakes.Audit(), Notifier(), TimeProvider.System)
                .Handle(new SendPublicMessageCommand(first.Link.Token, orders[0].Id, "unread"), default);
        }

        await using (var db = database.CreateContext())
        {
            await new SendPublicMessageHandler(db, TestFakes.Audit(), Notifier(), TimeProvider.System)
                .Handle(new SendPublicMessageCommand(first.Link.Token, first.Order.Id, "read later"), default);
            await new MarkConversationReadHandler(db, Notifier())
                .Handle(new MarkOrderConversationReadCommand(first.Order.Id), default);
        }

        await using (var db = database.CreateContext())
        {
            var list = await new GetConversationsHandler(db).Handle(new GetConversationsQuery(), default);
            list.UnreadConversations.ShouldBe(1);
            list.Items.Select(i => i.OrderNumber).ShouldBe([2, 1], "unread first even though the other is newer");
        }
    }

    [SqlFact]
    public async Task AnOrder_CanHaveOnlyOneConversation()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var s = await SeedAsync(database);

        await using var db = database.CreateContext();
        db.Conversations.Add(new Conversation
        {
            CustomerId = s.Customer.Id,
            Kind = (byte)ConversationKind.Order,
            OrderId = s.Order.Id,
            Title = "Order #1042",
            CreatedAt = DateTime.UtcNow,
            LastMessageAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await using var second = database.CreateContext();
        second.Conversations.Add(new Conversation
        {
            CustomerId = s.Customer.Id,
            Kind = (byte)ConversationKind.Order,
            OrderId = s.Order.Id,
            Title = "Order #1042",
            CreatedAt = DateTime.UtcNow,
            LastMessageAt = DateTime.UtcNow
        });
        await Should.ThrowAsync<DbUpdateException>(() => second.SaveChangesAsync());
    }

    [SqlFact]
    public async Task AMessage_NeedsItsConversation_AndStaffMessagesKeepTheirSender()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var s = await SeedAsync(database);

        await using var db = database.CreateContext();
        db.ConversationMessages.Add(new ConversationMessage
        {
            ConversationId = Guid.NewGuid(),
            SenderType = (byte)MessageSender.Customer,
            Body = "orphan",
            CreatedAt = DateTime.UtcNow
        });

        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
