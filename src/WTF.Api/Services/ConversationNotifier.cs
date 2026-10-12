using Microsoft.AspNetCore.SignalR;
using WTF.Api.Features.Conversations;
using WTF.Api.Hubs;
using WTF.Domain.Entities;

namespace WTF.Api.Services;

/// <summary>
/// Tells the other side that something happened. Everything here comes after the change was saved, so it is best
/// effort: a failed push or a closed connection is logged and never undoes or fails the change itself.
/// </summary>
public interface IConversationNotifier
{
    /// <summary>A message was saved. Staff and the customer both hear of it; a customer's message also pushes to staff.</summary>
    Task MessageSentAsync(
        Order order, Conversation conversation, ConversationMessage message, string? customerName,
        CancellationToken cancellationToken);

    /// <summary>Someone opened the chat, so unread counts changed on the other screens that are open.</summary>
    Task ConversationReadAsync(Order order, Conversation conversation, MessageSender readBy, CancellationToken cancellationToken);

    /// <summary>
    /// The order changed (accepted, rejected, ready, paid, cancelled...). The customer's page and the staff's open
    /// screens refresh it at once. <paramref name="systemMessageConversation"/> is the chat that got a system line, so
    /// an open chat shows it.
    /// </summary>
    Task OrderChangedAsync(Order order, Conversation? systemMessageConversation, CancellationToken cancellationToken);

    /// <summary>The link was revoked: every page open through it leaves.</summary>
    Task LinkRevokedAsync(Guid linkId, CancellationToken cancellationToken);
}

public sealed class ConversationNotifier(
    IHubContext<StaffOrderHub> staffHub,
    IHubContext<CustomerOrderHub> customerHub,
    IPushNotificationService push,
    ILogger<ConversationNotifier> logger) : IConversationNotifier
{
    public Task MessageSentAsync(
        Order order, Conversation conversation, ConversationMessage message, string? customerName,
        CancellationToken cancellationToken)
    {
        return Safely("message", async () =>
        {
            await staffHub.Clients.Group(HubNames.Groups.StaffOrders)
                .SendAsync(HubNames.Events.OrderMessageReceived, conversation.Id, order.Id, cancellationToken);

            if (order.CustomerId.HasValue)
            {
                await customerHub.Clients.Group(HubNames.Groups.Customer(order.CustomerId.Value))
                    .SendAsync(HubNames.Events.OrderMessageReceived, conversation.Id, order.Id, cancellationToken);
            }

            if (message.SenderType == (byte)MessageSender.Customer)
            {
                await push.SendOrderMessageAsync(
                    order, customerName, ConversationRules.PreviewOf(message.Body, message.ImageKey != null), cancellationToken);
            }
        });
    }

    public Task ConversationReadAsync(
        Order order, Conversation conversation, MessageSender readBy, CancellationToken cancellationToken)
    {
        return Safely("read", async () =>
        {
            // Other staff share the inbox, so their badges change whoever read it.
            await staffHub.Clients.Group(HubNames.Groups.StaffOrders)
                .SendAsync(HubNames.Events.ConversationRead, conversation.Id, order.Id, cancellationToken);

            // When the customer read the shop's replies, their other open pages (another tab or device) clear too.
            if (readBy == MessageSender.Customer && order.CustomerId.HasValue)
            {
                await customerHub.Clients.Group(HubNames.Groups.Customer(order.CustomerId.Value))
                    .SendAsync(HubNames.Events.ConversationRead, conversation.Id, order.Id, cancellationToken);
            }
        });
    }

    public Task OrderChangedAsync(Order order, Conversation? systemMessageConversation, CancellationToken cancellationToken)
    {
        return Safely("order change", async () =>
        {
            await staffHub.Clients.Group(HubNames.Groups.StaffOrders)
                .SendAsync(HubNames.Events.OrderStatusChanged, order.Id, cancellationToken);
            if (systemMessageConversation != null)
            {
                await staffHub.Clients.Group(HubNames.Groups.StaffOrders)
                    .SendAsync(HubNames.Events.OrderMessageReceived, systemMessageConversation.Id, order.Id, cancellationToken);
            }

            if (order.CustomerId.HasValue)
            {
                var customer = customerHub.Clients.Group(HubNames.Groups.Customer(order.CustomerId.Value));
                await customer.SendAsync(HubNames.Events.OrderStatusChanged, order.Id, cancellationToken);
                if (systemMessageConversation != null)
                {
                    await customer.SendAsync(
                        HubNames.Events.OrderMessageReceived, systemMessageConversation.Id, order.Id, cancellationToken);
                }
            }
        });
    }

    public Task LinkRevokedAsync(Guid linkId, CancellationToken cancellationToken)
    {
        return Safely("link revoked", async () =>
        {
            await customerHub.Clients.Group(HubNames.Groups.Link(linkId))
                .SendAsync(HubNames.Events.LinkRevoked, cancellationToken);
        });
    }

    private async Task Safely(string what, Func<Task> send)
    {
        try
        {
            await send();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not send the {What} notification.", what);
        }
    }
}
