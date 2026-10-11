using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Conversations;

/// <summary>What the staff and customer handlers both need: finding or starting a conversation, and reading messages.</summary>
internal static class ConversationStore
{
    private const byte CustomerSender = (byte)MessageSender.Customer;
    private const byte StaffSender = (byte)MessageSender.Staff;

    public static Task<Conversation?> FindForOrderAsync(WTFDbContext db, Guid orderId, CancellationToken cancellationToken) =>
        db.Conversations.FirstOrDefaultAsync(
            c => c.OrderId == orderId && c.Kind == (byte)ConversationKind.Order, cancellationToken);

    /// <summary>Adds a new Order conversation (it is saved with the first message). The order must have a customer.</summary>
    public static Conversation Start(WTFDbContext db, Order order, DateTime nowUtc)
    {
        if (!order.CustomerId.HasValue)
        {
            throw new InvalidOperationException("This order has no customer to chat with.");
        }

        var conversation = new Conversation
        {
            CustomerId = order.CustomerId.Value,
            Kind = (byte)ConversationKind.Order,
            OrderId = order.Id,
            Title = ConversationRules.OrderTitle(order.OrderNumber),
            CreatedAt = nowUtc,
            LastMessageAt = nowUtc
        };
        db.Conversations.Add(conversation);
        return conversation;
    }

    /// <summary>
    /// Writes a line into the order's chat saying what happened to the order ("Order accepted"). It is saved with the
    /// caller's next SaveChanges, so it lands together with the change itself. Only orders placed through a customer link
    /// start a chat for this; any other order gets the line only if it already has one. Returns the conversation, or null
    /// when nothing was written.
    /// </summary>
    public static async Task<Conversation?> AddSystemMessageAsync(
        WTFDbContext db, Order order, string body, Guid? staffUserId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        if (!order.CustomerId.HasValue)
        {
            return null;
        }

        var conversation = await FindForOrderAsync(db, order.Id, cancellationToken);
        if (conversation == null)
        {
            if (order.Source != (byte)OrderSourceEnum.CustomerLink)
            {
                return null;
            }

            conversation = Start(db, order, nowUtc);
        }

        db.ConversationMessages.Add(new ConversationMessage
        {
            Id = Guid.NewGuid(),
            Conversation = conversation,
            SenderType = (byte)MessageSender.System,
            SenderUserId = staffUserId,
            Body = ConversationRules.Trim(body),
            CreatedAt = nowUtc
        });
        conversation.LastMessageAt = nowUtc;
        return conversation;
    }

    /// <summary>The newest messages of a conversation, oldest first, with who wrote each.</summary>
    public static async Task<List<ConversationMessageDto>> LoadMessagesAsync(
        WTFDbContext db, Guid conversationId, bool forCustomer, CancellationToken cancellationToken)
    {
        var newest = await db.ConversationMessages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.CreatedAt)
            .Take(ConversationRules.MaxMessagesShown)
            .Select(m => new
            {
                m.Id,
                m.SenderType,
                m.Body,
                m.CreatedAt,
                First = m.SenderUser != null ? m.SenderUser.FirstName : null,
                Last = m.SenderUser != null ? m.SenderUser.LastName : null
            })
            .ToListAsync(cancellationToken);

        return [.. newest
            .OrderBy(m => m.CreatedAt)
            .Select(m => new ConversationMessageDto(
                m.Id,
                ConversationRules.SenderName((MessageSender)m.SenderType),
                m.SenderType != CustomerSender ? StaffName(m.First, m.Last, forCustomer) : null,
                m.Body,
                m.CreatedAt))];
    }

    public static ConversationMessageDto ToDto(ConversationMessage message, string? staffFirst, string? staffLast, bool forCustomer) =>
        new(
            message.Id,
            ConversationRules.SenderName((MessageSender)message.SenderType),
            message.SenderType != CustomerSender ? StaffName(staffFirst, staffLast, forCustomer) : null,
            message.Body,
            message.CreatedAt);

    /// <summary>A customer sees a staff member by first name only; staff see each other's full names.</summary>
    private static string? StaffName(string? first, string? last, bool forCustomer) =>
        forCustomer ? first : $"{first} {last}".Trim();

    public static Task<int> UnreadForStaffAsync(WTFDbContext db, Guid conversationId, CancellationToken cancellationToken) =>
        db.ConversationMessages.CountAsync(
            m => m.ConversationId == conversationId && m.SenderType == CustomerSender && m.ReadByStaffAt == null,
            cancellationToken);

    public static Task<int> UnreadForCustomerAsync(WTFDbContext db, Guid conversationId, CancellationToken cancellationToken) =>
        db.ConversationMessages.CountAsync(
            m => m.ConversationId == conversationId && m.SenderType == StaffSender && m.ReadByCustomerAt == null,
            cancellationToken);

    /// <summary>Marks the customer's messages as seen by staff. Returns how many were unread.</summary>
    public static async Task<int> MarkReadByStaffAsync(
        WTFDbContext db, Guid conversationId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var unread = await db.ConversationMessages
            .Where(m => m.ConversationId == conversationId && m.SenderType == CustomerSender && m.ReadByStaffAt == null)
            .ToListAsync(cancellationToken);
        foreach (var message in unread)
        {
            message.ReadByStaffAt = nowUtc;
        }

        return unread.Count;
    }

    /// <summary>Marks the shop's messages as seen by the customer. Returns how many were unread.</summary>
    public static async Task<int> MarkReadByCustomerAsync(
        WTFDbContext db, Guid conversationId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var unread = await db.ConversationMessages
            .Where(m => m.ConversationId == conversationId && m.SenderType == StaffSender && m.ReadByCustomerAt == null)
            .ToListAsync(cancellationToken);
        foreach (var message in unread)
        {
            message.ReadByCustomerAt = nowUtc;
        }

        return unread.Count;
    }

    /// <summary>
    /// The conversations for the envelope list: ones with something unread first, then newest. <paramref name="forCustomerId"/>
    /// limits it to one customer and counts the shop's replies as unread; without it, all customers' messages are counted.
    /// </summary>
    public static async Task<ConversationListDto> ListAsync(
        WTFDbContext db, Guid? forCustomerId, CancellationToken cancellationToken)
    {
        var unreadFrom = forCustomerId.HasValue ? StaffSender : CustomerSender;
        var query = db.Conversations.AsNoTracking().Where(c => c.Kind == (byte)ConversationKind.Order);
        if (forCustomerId.HasValue)
        {
            query = query.Where(c => c.CustomerId == forCustomerId.Value);
        }

        var isCustomerView = forCustomerId.HasValue;
        var rows = await query
            .Select(c => new
            {
                c.Id,
                c.OrderId,
                c.Title,
                c.LastMessageAt,
                OrderNumber = c.Order != null ? (int?)c.Order.OrderNumber : null,
                CustomerName = c.Customer.FirstName + " " + c.Customer.LastName,
                Unread = c.ConversationMessages.Count(m => m.SenderType == unreadFrom
                    && (isCustomerView ? m.ReadByCustomerAt == null : m.ReadByStaffAt == null)),
                Last = c.ConversationMessages
                    .OrderByDescending(m => m.CreatedAt)
                    .Select(m => new { m.Body, m.SenderType })
                    .FirstOrDefault()
            })
            .OrderByDescending(x => x.Unread > 0)
            .ThenByDescending(x => x.LastMessageAt)
            .Take(ConversationRules.MaxListItems)
            .ToListAsync(cancellationToken);

        var unreadConversations = await query.CountAsync(c => c.ConversationMessages.Any(m =>
            m.SenderType == unreadFrom && (isCustomerView ? m.ReadByCustomerAt == null : m.ReadByStaffAt == null)),
            cancellationToken);

        return new ConversationListDto(
            unreadConversations,
            [.. rows.Select(r => new ConversationSummaryDto(
                r.Id,
                r.OrderId,
                r.OrderNumber,
                r.Title,
                forCustomerId.HasValue ? null : r.CustomerName.Trim(),
                r.Last == null ? string.Empty : ConversationRules.Preview(r.Last.Body),
                r.Last == null ? string.Empty : ConversationRules.SenderName((MessageSender)r.Last.SenderType),
                r.LastMessageAt,
                r.Unread))]);
    }
}
