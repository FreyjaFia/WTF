using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Conversations;

/// <summary>What a conversation is about. Only Order chat is built; Support is here so it can be added later.</summary>
public enum ConversationKind : byte
{
    Order = 0,
    Support = 1
}

public enum MessageSender : byte
{
    Customer = 0,
    Staff = 1,

    /// <summary>The order changed (accepted, ready...). Written by the system, never typed; it is never unread.</summary>
    System = 2
}

/// <summary>One message as the screens show it. The customer sees a staff member's first name only.</summary>
public record ConversationMessageDto(
    Guid Id,
    string Sender,
    string? SenderName,
    string Body,
    DateTime CreatedAt,
    bool HasImage = false,
    int? ImageWidth = null,
    int? ImageHeight = null,
    bool ImageRemoved = false
);

/// <summary>
/// The chat of one order. <see cref="ConversationId"/> is null until the first message creates it. <see cref="CanSend"/>
/// is false once the order is over; <see cref="ClosedReason"/> then says why, for the screen to show.
/// </summary>
public record OrderConversationDto(
    Guid? ConversationId,
    Guid OrderId,
    int OrderNumber,
    string Title,
    bool CanSend,
    string? ClosedReason,
    int UnreadCount,
    List<ConversationMessageDto> Messages
);

/// <summary>One row of the envelope list: who it is with, the last message and how many are unread.</summary>
public record ConversationSummaryDto(
    Guid Id,
    Guid? OrderId,
    int? OrderNumber,
    string Title,
    string? CustomerName,
    string LastMessage,
    string LastSender,
    DateTime LastMessageAt,
    int UnreadCount
);

/// <summary><see cref="UnreadConversations"/> is what the envelope badge shows: conversations, not messages.</summary>
public record ConversationListDto(int UnreadConversations, List<ConversationSummaryDto> Items);

public record SendMessageRequest(string Body);

public static class ConversationRules
{
    public const int MaxBodyLength = 1000;
    public const int MaxListItems = 30;
    public const int MaxMessagesShown = 200;

    /// <summary>A customer who has not had an answer yet may send this many in a row, so a chat cannot be flooded.</summary>
    public const int MaxUnansweredCustomerMessages = 10;

    public const string ClosedOrderMessage = "This order is finished, so the chat is closed.";

    /// <summary>Plain text, trimmed, 1 to 1000 characters. It is never treated as HTML.</summary>
    public static string NormalizeBody(string? body)
    {
        var text = (body ?? string.Empty).Replace("\r\n", "\n").Trim();
        if (text.Length == 0)
        {
            throw new InvalidOperationException("A message cannot be empty.");
        }

        if (text.Length > MaxBodyLength)
        {
            throw new InvalidOperationException($"A message cannot be longer than {MaxBodyLength} characters.");
        }

        return text;
    }

    /// <summary>The optional text sent with a picture: trimmed, may be empty, never longer than a normal message.</summary>
    public static string NormalizeCaption(string? body)
    {
        var text = (body ?? string.Empty).Replace("\r\n", "\n").Trim();
        if (text.Length > MaxBodyLength)
        {
            throw new InvalidOperationException($"A message cannot be longer than {MaxBodyLength} characters.");
        }

        return text;
    }

    /// <summary>The short line for a list or a push: the text, or "Sent a photo" for a picture without text.</summary>
    public static string PreviewOf(string body, bool hasImage, bool imageRemoved = false, int max = 80)
    {
        if (!string.IsNullOrWhiteSpace(body))
        {
            return Preview(body, max);
        }

        return imageRemoved ? "Photo removed" : hasImage ? "Sent a photo" : string.Empty;
    }

    /// <summary>Fits a line of text into a message: flattened to one line and cut at the limit.</summary>
    public static string Trim(string text)
    {
        var flat = text.Replace("\r", " ").Replace("\n", " ").Trim();
        return flat.Length <= MaxBodyLength ? flat : flat[..(MaxBodyLength - 1)].TrimEnd() + "…";
    }

    public static string OrderTitle(int orderNumber) => $"Order #{orderNumber}";

    /// <summary>Chat is for orders placed through a customer link, and is open while they are waiting or accepted.</summary>
    public static bool IsChatOpen(Order order) =>
        order.Source == (byte)OrderSourceEnum.CustomerLink
        && (order.StatusId == (int)OrderStatusEnum.PendingApproval || order.StatusId == (int)OrderStatusEnum.Pending);

    public static string? ClosedReason(Order order) => IsChatOpen(order) ? null : ClosedOrderMessage;

    public static string Preview(string body, int max = 80)
    {
        var flat = body.Replace('\n', ' ');
        return flat.Length <= max ? flat : flat[..(max - 1)].TrimEnd() + "…";
    }

    public static string SenderName(MessageSender sender) => sender switch
    {
        MessageSender.Staff => "staff",
        MessageSender.System => "system",
        _ => "customer"
    };
}

/// <summary>The system lines an order's chat shows when the order moves on without a typed message.</summary>
public static class OrderChatLines
{
    /// <summary>The line for an order that just reached this status, or null when the status has none.</summary>
    public static string? For(OrderStatusEnum status) => status switch
    {
        OrderStatusEnum.Pending => "Order accepted",
        OrderStatusEnum.Completed => "Order completed",
        OrderStatusEnum.Cancelled => "Order cancelled",
        OrderStatusEnum.Refunded => "Order refunded",
        _ => null
    };
}
