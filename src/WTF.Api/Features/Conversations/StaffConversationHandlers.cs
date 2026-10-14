using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Conversations;

/// <summary>The envelope list for staff: every customer's conversations, unread first.</summary>
public record GetConversationsQuery : IRequest<ConversationListDto>;

/// <summary>The chat of one order. Null for an order that does not exist or is not a customer link order.</summary>
public record GetOrderConversationQuery(Guid OrderId) : IRequest<OrderConversationDto?>;

/// <summary>A staff reply. Null for an unknown order.</summary>
public record SendStaffMessageCommand(Guid OrderId, string Body, byte[]? Image = null) : IRequest<ConversationMessageDto?>;

/// <summary>One picture of a message in an order's chat, for staff.</summary>
public record GetMessageImageQuery(Guid OrderId, Guid MessageId) : IRequest<ChatImageFile?>;

/// <summary>Staff removes a message's picture. The message stays and shows "photo removed".</summary>
public record RemoveMessageImageCommand(Guid OrderId, Guid MessageId) : IRequest<ConversationMessageDto?>;

/// <summary>Staff opened the chat: the customer's messages count as read for everyone on the staff.</summary>
public record MarkOrderConversationReadCommand(Guid OrderId) : IRequest<bool>;

public class GetConversationsHandler(WTFDbContext db) : IRequestHandler<GetConversationsQuery, ConversationListDto>
{
    public Task<ConversationListDto> Handle(GetConversationsQuery request, CancellationToken cancellationToken) =>
        ConversationStore.ListAsync(db, null, cancellationToken);
}

public class GetOrderConversationHandler(WTFDbContext db, IOptions<ChatRetentionOptions>? retention = null)
    : IRequestHandler<GetOrderConversationQuery, OrderConversationDto?>
{
    public async Task<OrderConversationDto?> Handle(GetOrderConversationQuery request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == request.OrderId, cancellationToken);
        if (order == null || order.Source != (byte)OrderSourceEnum.CustomerLink)
        {
            return null;
        }

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
            await ConversationStore.UnreadForStaffAsync(db, conversation.Id, cancellationToken),
            await ConversationStore.LoadMessagesAsync(db, conversation.Id, false, cancellationToken),
            retention?.Value.DaysToShow);
    }
}

public class SendStaffMessageHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IConversationNotifier notifier,
    IChatImageService? chatImages = null) : IRequestHandler<SendStaffMessageCommand, ConversationMessageDto?>
{
    public async Task<ConversationMessageDto?> Handle(SendStaffMessageCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.OrderId, cancellationToken);
        if (order == null)
        {
            return null;
        }

        if (order.Source != (byte)OrderSourceEnum.CustomerLink)
        {
            throw new InvalidOperationException("Chat is only for orders placed through a customer link.");
        }

        if (!ConversationRules.IsChatOpen(order))
        {
            throw new InvalidOperationException(ConversationRules.ClosedOrderMessage);
        }

        var hasImage = request.Image != null;
        var body = hasImage ? ConversationRules.NormalizeCaption(request.Body) : ConversationRules.NormalizeBody(request.Body);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

        // A picture is checked and re-encoded before anything is written; one that looks hostile is recorded.
        ProcessedChatImage? processed = null;
        if (hasImage)
        {
            if (chatImages == null)
            {
                throw new InvalidOperationException("Pictures are not available right now.");
            }

            try
            {
                processed = chatImages.Prepare(request.Image!);
            }
            catch (ChatImageException ex) when (ex.Suspicious)
            {
                await auditService.LogAsync(
                    action: AuditAction.ChatImageRejected,
                    entityType: AuditEntityType.Conversation,
                    entityId: order.Id.ToString(),
                    newValues: new { order.OrderNumber, Reason = ex.Message, Bytes = request.Image!.Length, By = "Staff" },
                    userId: userId,
                    cancellationToken: cancellationToken);
                throw;
            }
        }

        var conversation = await ConversationStore.FindForOrderAsync(db, order.Id, cancellationToken);
        var started = conversation == null;
        conversation ??= ConversationStore.Start(db, order, now);

        var message = new WTF.Domain.Entities.ConversationMessage
        {
            Conversation = conversation,
            SenderType = (byte)MessageSender.Staff,
            SenderUserId = userId,
            Body = body,
            CreatedAt = now,
            ReadByStaffAt = now
        };
        db.ConversationMessages.Add(message);
        conversation.LastMessageAt = now;

        // Answering means the customer's earlier messages were read.
        if (!started)
        {
            await ConversationStore.MarkReadByStaffAsync(db, conversation.Id, now, cancellationToken);
        }

        // The picture is stored just before the row is saved; if saving fails the file is removed again.
        string? storedKey = null;
        try
        {
            if (processed != null)
            {
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
                try
                {
                    await chatImages!.DeleteAsync(storedKey, CancellationToken.None);
                }
                catch
                {
                    // Best effort.
                }
            }

            throw;
        }

        if (started)
        {
            await auditService.LogAsync(
                action: AuditAction.ConversationStarted,
                entityType: AuditEntityType.Conversation,
                entityId: conversation.Id.ToString(),
                newValues: new { conversation.Title, order.OrderNumber, StartedBy = "Staff" },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        var sender = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.FirstName, u.LastName })
            .FirstOrDefaultAsync(cancellationToken);

        await notifier.MessageSentAsync(order, conversation, message, null, cancellationToken);
        return ConversationStore.ToDto(message, sender?.FirstName, sender?.LastName, forCustomer: false);
    }
}

public class MarkConversationReadHandler(WTFDbContext db, IConversationNotifier notifier)
    : IRequestHandler<MarkOrderConversationReadCommand, bool>
{
    public async Task<bool> Handle(MarkOrderConversationReadCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == request.OrderId, cancellationToken);
        if (order == null || order.Source != (byte)OrderSourceEnum.CustomerLink)
        {
            return false;
        }

        var conversation = await ConversationStore.FindForOrderAsync(db, order.Id, cancellationToken);
        if (conversation == null)
        {
            return true;
        }

        var changed = await ConversationStore.MarkReadByStaffAsync(db, conversation.Id, DateTime.UtcNow, cancellationToken);
        if (changed > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            await notifier.ConversationReadAsync(order, conversation, MessageSender.Staff, cancellationToken);
        }

        return true;
    }
}

public class GetMessageImageHandler(WTFDbContext db, IChatImageService? chatImages = null)
    : IRequestHandler<GetMessageImageQuery, ChatImageFile?>
{
    public async Task<ChatImageFile?> Handle(GetMessageImageQuery request, CancellationToken cancellationToken)
    {
        var isCustomerLinkOrder = await db.Orders.AsNoTracking().AnyAsync(
            o => o.Id == request.OrderId && o.Source == (byte)OrderSourceEnum.CustomerLink, cancellationToken);
        if (!isCustomerLinkOrder || chatImages == null)
        {
            return null;
        }

        return await ConversationStore.ReadImageAsync(db, chatImages, request.OrderId, request.MessageId, cancellationToken);
    }
}

public class RemoveMessageImageHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IConversationNotifier notifier,
    TimeProvider timeProvider,
    IChatImageService? chatImages = null) : IRequestHandler<RemoveMessageImageCommand, ConversationMessageDto?>
{
    public async Task<ConversationMessageDto?> Handle(RemoveMessageImageCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(
            o => o.Id == request.OrderId && o.Source == (byte)OrderSourceEnum.CustomerLink, cancellationToken);
        if (order == null || chatImages == null)
        {
            return null;
        }

        var message = await db.ConversationMessages
            .Include(m => m.Conversation)
            .Include(m => m.SenderUser)
            .FirstOrDefaultAsync(
                m => m.Id == request.MessageId && m.Conversation.OrderId == order.Id && m.ImageKey != null,
                cancellationToken);
        if (message == null)
        {
            return null;
        }

        // The file goes first, then the row: if deleting the file fails, the row still points to it and the removal
        // can be tried again, instead of leaving a file nothing knows about.
        var key = message.ImageKey!;
        await chatImages.DeleteAsync(key, cancellationToken);

        ConversationStore.ClearImage(message, timeProvider.GetUtcNow().UtcDateTime);
        await db.SaveChangesAsync(cancellationToken);

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        await auditService.LogAsync(
            action: AuditAction.ChatImageRemoved,
            entityType: AuditEntityType.Conversation,
            entityId: message.ConversationId.ToString(),
            newValues: new { order.OrderNumber, MessageId = message.Id },
            userId: userId,
            cancellationToken: cancellationToken);

        await notifier.OrderChangedAsync(order, message.Conversation, cancellationToken);
        return ConversationStore.ToDto(message, message.SenderUser?.FirstName, message.SenderUser?.LastName, forCustomer: false);
    }
}
