using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>
/// Chat message expiry against a real SQL Server: the batch delete with its joins to the order, the foreign keys when
/// a conversation goes, and that an order is left exactly as it was.
/// </summary>
public class ChatMessageExpiryDatabaseTests
{
    private static ChatMessageExpiryService Service(WTF.Domain.Data.WTFDbContext db, ChatRetentionOptions options, IChatImageService? images = null) =>
        new(db, Substitute.For<IReportFileStorage>(), Options.Create(options), NullLogger<ChatMessageExpiryService>.Instance, images);

    private static async Task<(Guid ConversationId, Guid OrderId)> ChatAsync(
        SqlTestDatabase database, User staff, OrderStatusEnum status, int number, params int[] ageDays)
    {
        await using var db = database.CreateContext();
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
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
            CreatedAt = DateTime.UtcNow.AddDays(-300),
            CreatedBy = staff.Id
        };
        var conversation = new Conversation
        {
            Id = Guid.NewGuid(),
            CustomerId = customer.Id,
            Kind = (byte)ConversationKind.Order,
            OrderId = order.Id,
            Title = ConversationRules.OrderTitle(number),
            CreatedAt = DateTime.UtcNow.AddDays(-ageDays.Max()),
            LastMessageAt = DateTime.UtcNow.AddDays(-ageDays.Min())
        };
        db.Customers.Add(customer);
        db.Orders.Add(order);
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync();

        db.ConversationMessages.AddRange(ageDays.Select(age => new ConversationMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            SenderType = (byte)MessageSender.Customer,
            Body = $"{age} days",
            CreatedAt = DateTime.UtcNow.AddDays(-age),
            ReadByCustomerAt = DateTime.UtcNow
        }));
        await db.SaveChangesAsync();
        return (conversation.Id, order.Id);
    }

    [SqlFact]
    public async Task ABacklogOfOldMessages_IsDeletedInBatches_ForFinishedOrdersOnly_AndTheOrderIsUntouched()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var staff = await SqlSeed.UserAsync(database, "cashier", roleId: 2);
        var finished = await ChatAsync(database, staff, OrderStatusEnum.Completed, 1001, 100, 110, 120, 130, 140, 150, 3);
        var open = await ChatAsync(database, staff, OrderStatusEnum.Pending, 1002, 400, 300);
        var gone = await ChatAsync(database, staff, OrderStatusEnum.Cancelled, 1003, 200, 210);

        ChatMessageExpiryResult result;
        await using (var db = database.CreateContext())
        {
            result = await Service(db, new ChatRetentionOptions { DryRun = false, BatchSize = 2 }).RunAsync(default);
        }

        result.DeletedMessages.ShouldBe(8, "six old ones of the finished order and two of the cancelled one");
        result.DeletedConversations.ShouldBe(1, "the cancelled order's chat is left with nothing");
        await using var check = database.CreateContext();
        (await check.ConversationMessages.CountAsync(m => m.ConversationId == finished.ConversationId)).ShouldBe(1);
        (await check.ConversationMessages.CountAsync(m => m.ConversationId == open.ConversationId)).ShouldBe(2);
        (await check.Conversations.AnyAsync(c => c.Id == gone.ConversationId)).ShouldBeFalse();
        (await check.Conversations.AnyAsync(c => c.Id == finished.ConversationId)).ShouldBeTrue();
        (await check.Orders.CountAsync(o => o.Id == gone.OrderId || o.Id == finished.OrderId || o.Id == open.OrderId)).ShouldBe(3);
        (await check.Orders.SingleAsync(o => o.Id == gone.OrderId)).StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
    }

    [SqlFact]
    public async Task ADryRunOnARealDatabase_DeletesNothing()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var staff = await SqlSeed.UserAsync(database, "cashier", roleId: 2);
        await ChatAsync(database, staff, OrderStatusEnum.Completed, 1001, 100, 200);

        await using (var db = database.CreateContext())
        {
            var result = await Service(db, new ChatRetentionOptions { DryRun = true }).RunAsync(default);
            result.EligibleMessages.ShouldBe(2);
        }

        await using var check = database.CreateContext();
        (await check.ConversationMessages.CountAsync()).ShouldBe(2);
    }
}
