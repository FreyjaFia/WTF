using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Conversations;

/// <summary>The customer's envelope list: their own order chats, with the shop's unanswered replies first.</summary>
public record GetPublicConversationsQuery(string Token) : IRequest<ConversationListDto?>;

/// <summary>The chat of one of the customer's orders.</summary>
public record GetPublicOrderConversationQuery(string Token, Guid OrderId) : IRequest<OrderConversationDto?>;

/// <summary>A customer's message about one of their orders.</summary>
public record SendPublicMessageCommand(string Token, Guid OrderId, string Body) : IRequest<ConversationMessageDto?>;

/// <summary>The customer opened the chat: the shop's replies count as read.</summary>
public record MarkPublicConversationReadCommand(string Token, Guid OrderId) : IRequest<bool>;

/// <summary>
/// Every customer-side chat route starts with the same token check as the rest of the public page, so a revoked, expired
/// or switched-off link answers with the same "not found" and nothing about any order is revealed. A customer only ever
/// reaches the chat of an order they placed through a link.
/// </summary>
internal static class PublicChatAccess
{
    public static async Task<(OrderLinkAccessResult Access, Order Order)?> ResolveAsync(
        WTFDbContext db, string token, Guid orderId, bool track, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, token, cancellationToken);
        if (access == null)
        {
            return null;
        }

        var orders = track ? db.Orders.AsQueryable() : db.Orders.AsNoTracking();
        var order = await orders.FirstOrDefaultAsync(
            o => o.Id == orderId
                 && o.CustomerId == access.Customer.Id
                 && o.Source == (byte)OrderSourceEnum.CustomerLink,
            cancellationToken);

        return order == null ? null : (access, order);
    }
}

public class GetPublicConversationsHandler(WTFDbContext db)
    : IRequestHandler<GetPublicConversationsQuery, ConversationListDto?>
{
    public async Task<ConversationListDto?> Handle(GetPublicConversationsQuery request, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, request.Token, cancellationToken);
        return access == null ? null : await ConversationStore.ListAsync(db, access.Customer.Id, cancellationToken);
    }
}

public class GetPublicOrderConversationHandler(WTFDbContext db)
    : IRequestHandler<GetPublicOrderConversationQuery, OrderConversationDto?>
{
    public async Task<OrderConversationDto?> Handle(
        GetPublicOrderConversationQuery request, CancellationToken cancellationToken)
    {
        var found = await PublicChatAccess.ResolveAsync(db, request.Token, request.OrderId, false, cancellationToken);
        if (found == null)
        {
            return null;
        }

        var order = found.Value.Order;
        var conversation = await db.Conversations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.OrderId == order.Id && c.Kind == (byte)ConversationKind.Order, cancellationToken);

        if (conversation == null)
        {
            return new OrderConversationDto(
                null, order.Id, order.OrderNumber, ConversationRules.OrderTitle(order.OrderNumber),
                ConversationRules.IsChatOpen(order), ConversationRules.ClosedReason(order), 0, []);
        }

        return new OrderConversationDto(
            conversation.Id,
            order.Id,
            order.OrderNumber,
            conversation.Title,
            ConversationRules.IsChatOpen(order),
            ConversationRules.ClosedReason(order),
            await ConversationStore.UnreadForCustomerAsync(db, conversation.Id, cancellationToken),
            await ConversationStore.LoadMessagesAsync(db, conversation.Id, true, cancellationToken));
    }
}

public class SendPublicMessageHandler(
    WTFDbContext db,
    IAuditService auditService,
    IConversationNotifier notifier,
    TimeProvider timeProvider) : IRequestHandler<SendPublicMessageCommand, ConversationMessageDto?>
{
    public async Task<ConversationMessageDto?> Handle(SendPublicMessageCommand request, CancellationToken cancellationToken)
    {
        var found = await PublicChatAccess.ResolveAsync(db, request.Token, request.OrderId, true, cancellationToken);
        if (found == null)
        {
            return null;
        }

        var (access, order) = found.Value;
        if (!ConversationRules.IsChatOpen(order))
        {
            throw new InvalidOperationException(ConversationRules.ClosedOrderMessage);
        }

        var body = ConversationRules.NormalizeBody(request.Body);
        var now = timeProvider.GetUtcNow().UtcDateTime;

        var conversation = await ConversationStore.FindForOrderAsync(db, order.Id, cancellationToken);
        var started = conversation == null;
        if (!started)
        {
            await EnsureNotFloodingAsync(conversation!.Id, cancellationToken);
        }

        conversation ??= ConversationStore.Start(db, order, now);

        var message = new ConversationMessage
        {
            Conversation = conversation,
            SenderType = (byte)MessageSender.Customer,
            Body = body,
            CreatedAt = now,
            ReadByCustomerAt = now
        };
        db.ConversationMessages.Add(message);
        conversation.LastMessageAt = now;

        // Asking again, right before saving, whether the link still works: it may have been revoked while the customer
        // was typing, and then nothing may be written.
        if (!await OrderLinkAccess.IsStillValidAsync(db, access.Link.Id, now, cancellationToken))
        {
            return null;
        }

        await db.SaveChangesAsync(cancellationToken);

        if (started)
        {
            await auditService.LogAsync(
                action: AuditAction.ConversationStarted,
                entityType: AuditEntityType.Conversation,
                entityId: conversation.Id.ToString(),
                newValues: new { conversation.Title, order.OrderNumber, StartedBy = "Customer" },
                userId: await SystemUserIdAsync(cancellationToken),
                cancellationToken: cancellationToken);
        }

        var customerName = $"{access.Customer.FirstName} {access.Customer.LastName}".Trim();
        await notifier.MessageSentAsync(order, conversation, message, customerName, cancellationToken);
        return ConversationStore.ToDto(message, null, null, forCustomer: true);
    }

    /// <summary>The audit log needs a user: a customer's action is recorded under the same system user as their orders.</summary>
    private Task<Guid?> SystemUserIdAsync(CancellationToken cancellationToken) =>
        db.Users.AsNoTracking()
            .Where(u => u.Username == SubmitPublicOrderHandler.SystemUsername)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>A customer may send a handful of messages in a row; after that the shop has to answer first.</summary>
    private async Task EnsureNotFloodingAsync(Guid conversationId, CancellationToken cancellationToken)
    {
        var lastReply = await db.ConversationMessages
            .Where(m => m.ConversationId == conversationId && m.SenderType == (byte)MessageSender.Staff)
            .MaxAsync(m => (DateTime?)m.CreatedAt, cancellationToken);

        var unanswered = await db.ConversationMessages.CountAsync(
            m => m.ConversationId == conversationId
                 && m.SenderType == (byte)MessageSender.Customer
                 && (lastReply == null || m.CreatedAt > lastReply),
            cancellationToken);

        if (unanswered >= ConversationRules.MaxUnansweredCustomerMessages)
        {
            throw new InvalidOperationException("Please wait for the shop to reply before sending more messages.");
        }
    }
}

public class MarkPublicConversationReadHandler(WTFDbContext db, TimeProvider timeProvider, IConversationNotifier notifier)
    : IRequestHandler<MarkPublicConversationReadCommand, bool>
{
    public async Task<bool> Handle(MarkPublicConversationReadCommand request, CancellationToken cancellationToken)
    {
        var found = await PublicChatAccess.ResolveAsync(db, request.Token, request.OrderId, false, cancellationToken);
        if (found == null)
        {
            return false;
        }

        var order = found.Value.Order;
        var conversation = await ConversationStore.FindForOrderAsync(db, order.Id, cancellationToken);
        if (conversation == null)
        {
            return true;
        }

        var changed = await ConversationStore.MarkReadByCustomerAsync(
            db, conversation.Id, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
        if (changed > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            await notifier.ConversationReadAsync(order, conversation, MessageSender.Customer, cancellationToken);
        }

        return true;
    }
}
