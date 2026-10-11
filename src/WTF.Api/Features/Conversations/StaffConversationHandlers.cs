using MediatR;
using Microsoft.EntityFrameworkCore;
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
public record SendStaffMessageCommand(Guid OrderId, string Body) : IRequest<ConversationMessageDto?>;

/// <summary>Staff opened the chat: the customer's messages count as read for everyone on the staff.</summary>
public record MarkOrderConversationReadCommand(Guid OrderId) : IRequest<bool>;

public class GetConversationsHandler(WTFDbContext db) : IRequestHandler<GetConversationsQuery, ConversationListDto>
{
    public Task<ConversationListDto> Handle(GetConversationsQuery request, CancellationToken cancellationToken) =>
        ConversationStore.ListAsync(db, null, cancellationToken);
}

public class GetOrderConversationHandler(WTFDbContext db)
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
                ConversationRules.IsChatOpen(order), ConversationRules.ClosedReason(order), 0, []);
        }

        return new OrderConversationDto(
            conversation.Id,
            order.Id,
            order.OrderNumber,
            conversation.Title,
            ConversationRules.IsChatOpen(order),
            ConversationRules.ClosedReason(order),
            await ConversationStore.UnreadForStaffAsync(db, conversation.Id, cancellationToken),
            await ConversationStore.LoadMessagesAsync(db, conversation.Id, false, cancellationToken));
    }
}

public class SendStaffMessageHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IConversationNotifier notifier) : IRequestHandler<SendStaffMessageCommand, ConversationMessageDto?>
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

        var body = ConversationRules.NormalizeBody(request.Body);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

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

        await db.SaveChangesAsync(cancellationToken);

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
