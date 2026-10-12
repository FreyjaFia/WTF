using MediatR;
using Microsoft.Extensions.Options;
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
public record SendPublicMessageCommand(string Token, Guid OrderId, string Body, byte[]? Image = null)
    : IRequest<ConversationMessageDto?>;

/// <summary>One picture from a message of one of the customer's own orders.</summary>
public record GetPublicMessageImageQuery(string Token, Guid OrderId, Guid MessageId) : IRequest<ChatImageFile?>;

/// <summary>The customer takes back a picture they sent. The message stays and shows "photo removed".</summary>
public record RemovePublicMessageImageCommand(string Token, Guid OrderId, Guid MessageId) : IRequest<ConversationMessageDto?>;

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

public class GetPublicOrderConversationHandler(WTFDbContext db, IOptions<ChatRetentionOptions>? retention = null)
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
                ConversationRules.IsChatOpen(order), ConversationRules.ClosedReason(order), 0, [], retention?.Value.DaysToShow);
        }

        return new OrderConversationDto(
            conversation.Id,
            order.Id,
            order.OrderNumber,
            conversation.Title,
            ConversationRules.IsChatOpen(order),
            ConversationRules.ClosedReason(order),
            await ConversationStore.UnreadForCustomerAsync(db, conversation.Id, cancellationToken),
            await ConversationStore.LoadMessagesAsync(db, conversation.Id, true, cancellationToken),
            retention?.Value.DaysToShow);
    }
}

public class SendPublicMessageHandler(
    WTFDbContext db,
    IAuditService auditService,
    IConversationNotifier notifier,
    TimeProvider timeProvider,
    IChatImageService? chatImages = null) : IRequestHandler<SendPublicMessageCommand, ConversationMessageDto?>
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

        var hasImage = request.Image != null;
        var body = hasImage ? ConversationRules.NormalizeCaption(request.Body) : ConversationRules.NormalizeBody(request.Body);
        var now = timeProvider.GetUtcNow().UtcDateTime;

        var conversation = await ConversationStore.FindForOrderAsync(db, order.Id, cancellationToken);
        var started = conversation == null;
        if (!started)
        {
            await EnsureNotFloodingAsync(conversation!.Id, cancellationToken);
        }

        // A picture is checked and re-encoded before anything is written. A refusal is explained to the sender, and one
        // that looks hostile (wrong type, oversized, damaged) is recorded.
        ProcessedChatImage? processed = null;
        if (hasImage)
        {
            if (chatImages == null)
            {
                throw new InvalidOperationException("Pictures are not available right now.");
            }

            await EnsureUnderDailyImageLimitAsync(access.Customer.Id, now, chatImages.DailyLimitPerCustomer, cancellationToken);
            try
            {
                processed = chatImages.Prepare(request.Image!);
            }
            catch (ChatImageException ex) when (ex.Suspicious)
            {
                await auditService.LogAsync(
                    action: AuditAction.ChatImageRejected,
                    entityType: AuditEntityType.Conversation,
                    entityId: conversation?.Id.ToString() ?? order.Id.ToString(),
                    newValues: new { order.OrderNumber, Reason = ex.Message, Bytes = request.Image!.Length, By = "Customer" },
                    userId: await SystemUserIdAsync(cancellationToken),
                    cancellationToken: cancellationToken);
                throw;
            }
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

        // The picture is stored just before the row is saved; if saving fails the file is removed again, so no
        // file is left without a message.
        string? storedKey = null;
        try
        {
            if (processed != null)
            {
                // The folder name only groups a chat's files; a new chat has no final id until it is saved.
                var folder = conversation.Id == Guid.Empty ? Guid.NewGuid() : conversation.Id;
                storedKey = await chatImages!.SaveAsync(folder, processed, cancellationToken);
                message.ImageKey = storedKey;
                message.ImageContentType = processed.ContentType;
                message.ImageWidth = processed.Width;
                message.ImageHeight = processed.Height;
                message.ImageSizeBytes = processed.Data.Length;
            }

            await db.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            if (storedKey != null)
            {
                await TryDeleteAsync(storedKey);
            }

            throw;
        }

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

    private async Task TryDeleteAsync(string key)
    {
        try
        {
            await chatImages!.DeleteAsync(key, CancellationToken.None);
        }
        catch
        {
            // Best effort: a file that could not be removed here is cleaned up with the chat later.
        }
    }

    /// <summary>One customer may send only so many pictures a day, over all their chats.</summary>
    private async Task EnsureUnderDailyImageLimitAsync(Guid customerId, DateTime now, int limit, CancellationToken cancellationToken)
    {
        if (limit <= 0)
        {
            return;
        }

        var since = now.AddDays(-1);
        var sent = await db.ConversationMessages.CountAsync(
            m => m.SenderType == (byte)MessageSender.Customer
                 && (m.ImageKey != null || m.ImageRemovedAt != null)
                 && m.CreatedAt > since
                 && m.Conversation.CustomerId == customerId,
            cancellationToken);

        if (sent >= limit)
        {
            throw new InvalidOperationException("You have sent a lot of photos today. Please try again tomorrow.");
        }
    }

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

public class GetPublicMessageImageHandler(WTFDbContext db, IChatImageService? chatImages = null)
    : IRequestHandler<GetPublicMessageImageQuery, ChatImageFile?>
{
    public async Task<ChatImageFile?> Handle(GetPublicMessageImageQuery request, CancellationToken cancellationToken)
    {
        // Same checks as reading the messages: a working link, and an order that is this customer's.
        var found = await PublicChatAccess.ResolveAsync(db, request.Token, request.OrderId, false, cancellationToken);
        if (found == null || chatImages == null)
        {
            return null;
        }

        return await ConversationStore.ReadImageAsync(db, chatImages, found.Value.Order.Id, request.MessageId, cancellationToken);
    }
}

public class RemovePublicMessageImageHandler(
    WTFDbContext db,
    IAuditService auditService,
    IConversationNotifier notifier,
    TimeProvider timeProvider,
    IChatImageService? chatImages = null) : IRequestHandler<RemovePublicMessageImageCommand, ConversationMessageDto?>
{
    public async Task<ConversationMessageDto?> Handle(RemovePublicMessageImageCommand request, CancellationToken cancellationToken)
    {
        var found = await PublicChatAccess.ResolveAsync(db, request.Token, request.OrderId, false, cancellationToken);
        if (found == null || chatImages == null)
        {
            return null;
        }

        var order = found.Value.Order;

        // Only the customer's own pictures, and only while the chat is open (a finished order's chat is history).
        var message = await db.ConversationMessages
            .Include(m => m.Conversation)
            .FirstOrDefaultAsync(
                m => m.Id == request.MessageId
                     && m.Conversation.OrderId == order.Id
                     && m.SenderType == (byte)MessageSender.Customer
                     && m.ImageKey != null,
                cancellationToken);
        if (message == null)
        {
            return null;
        }

        if (!ConversationRules.IsChatOpen(order))
        {
            throw new InvalidOperationException(ConversationRules.ClosedOrderMessage);
        }

        // The file goes first, then the row, so a failed delete can simply be tried again.
        await chatImages.DeleteAsync(message.ImageKey!, cancellationToken);
        ConversationStore.ClearImage(message, timeProvider.GetUtcNow().UtcDateTime);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.ChatImageRemoved,
            entityType: AuditEntityType.Conversation,
            entityId: message.ConversationId.ToString(),
            newValues: new { order.OrderNumber, MessageId = message.Id, By = "Customer" },
            userId: await db.Users.AsNoTracking()
                .Where(u => u.Username == SubmitPublicOrderHandler.SystemUsername)
                .Select(u => (Guid?)u.Id)
                .FirstOrDefaultAsync(cancellationToken),
            cancellationToken: cancellationToken);

        await notifier.OrderChangedAsync(order, message.Conversation, cancellationToken);
        return ConversationStore.ToDto(message, null, null, forCustomer: true);
    }
}
