using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Services;

public interface IPushNotificationService
{
    Task SendOrderCreatedAsync(
        Order order,
        decimal totalAmount,
        Guid actorUserId,
        CancellationToken cancellationToken);

    /// <summary>
    /// A customer placed an order through their ordering link. It goes to every active staff member (the order is owned
    /// by the system user, so nobody is excluded as the actor) and opens the orders list, where it waits for approval.
    /// </summary>
    Task SendLinkOrderCreatedAsync(
        Order order,
        decimal totalAmount,
        string? customerName,
        FulfillmentTypeEnum? fulfillment,
        CancellationToken cancellationToken);

    /// <summary>
    /// A customer wrote in an order's chat. It goes to the same staff as a new online order (never viewers, who cannot
    /// reply) and opens that order with its chat open.
    /// </summary>
    Task SendOrderMessageAsync(
        Order order,
        string? customerName,
        string preview,
        CancellationToken cancellationToken);

    Task SendOrderStatusChangedAsync(
        Order order,
        decimal totalAmount,
        OrderStatusEnum newStatus,
        Guid actorUserId,
        CancellationToken cancellationToken,
        bool isOverride = false);

    /// <summary>Any kind of notification (see Features/Notifications). It goes to the named people only and opens <c>path</c>.</summary>
    Task SendNotificationAsync(
        IReadOnlyCollection<Guid> userIds,
        string title,
        string body,
        string? path,
        string kind,
        Guid? subjectId,
        CancellationToken cancellationToken);
}

/// <summary>Values of the <c>type</c> field in push data, so the app can route each kind of notification.</summary>
public static class PushTypes
{
    public const string OnlineOrder = "online-order";
    public const string OrderMessage = "order-message";
    public const string Notification = "notification";
}

public sealed class PushNotificationService(
    WTFDbContext db,
    IFcmPushClient fcmClient,
    IHuaweiPushClient huaweiClient,
    ILogger<PushNotificationService> logger) : IPushNotificationService
{
    private const string PlatformHuawei = "huawei";

    public Task SendOrderCreatedAsync(
        Order order,
        decimal totalAmount,
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        var data = new Dictionary<string, string>
        {
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber.ToString(),
            ["path"] = $"/orders/editor/{order.Id}"
        };

        return SendToOthersAsync(
            order,
            "New order created",
            $"Order #{order.OrderNumber} • PHP {totalAmount:N2}",
            data,
            actorUserId,
            cancellationToken);
    }

    public Task SendLinkOrderCreatedAsync(
        Order order,
        decimal totalAmount,
        string? customerName,
        FulfillmentTypeEnum? fulfillment,
        CancellationToken cancellationToken)
    {
        var data = new Dictionary<string, string>
        {
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber.ToString(),
            ["type"] = PushTypes.OnlineOrder,
            ["path"] = "/orders/list"
        };

        var parts = new List<string> { $"Order #{order.OrderNumber}" };
        if (!string.IsNullOrWhiteSpace(customerName))
        {
            parts.Add(customerName.Trim());
        }

        if (fulfillment.HasValue)
        {
            parts.Add(fulfillment.Value.ToString());
        }

        parts.Add($"PHP {totalAmount:N2}");

        return SendToOthersAsync(
            order,
            "New online order",
            string.Join(" · ", parts),
            data,
            Guid.Empty,
            cancellationToken);
    }

    public Task SendOrderMessageAsync(
        Order order,
        string? customerName,
        string preview,
        CancellationToken cancellationToken)
    {
        // A waiting order only has its details page; an accepted one is opened in the editor.
        var screen = order.StatusId == (int)OrderStatusEnum.PendingApproval ? "details" : "editor";
        var data = new Dictionary<string, string>
        {
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber.ToString(),
            ["type"] = PushTypes.OrderMessage,
            ["path"] = $"/orders/{screen}/{order.Id}",
            ["chat"] = "open"
        };

        var who = string.IsNullOrWhiteSpace(customerName) ? "Customer" : customerName.Trim();
        return SendToOthersAsync(
            order,
            $"New message on order #{order.OrderNumber}",
            $"{who}: {preview}",
            data,
            Guid.Empty,
            cancellationToken);
    }

    public Task SendOrderStatusChangedAsync(
        Order order,
        decimal totalAmount,
        OrderStatusEnum newStatus,
        Guid actorUserId,
        CancellationToken cancellationToken,
        bool isOverride = false)
    {
        var statusLabel = isOverride
            ? "overridden"
            : newStatus switch
            {
                OrderStatusEnum.Completed => "completed",
                OrderStatusEnum.Cancelled => "cancelled",
                OrderStatusEnum.Refunded => "refunded",
                _ => "updated"
            };

        var data = new Dictionary<string, string>
        {
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber.ToString(),
            ["status"] = newStatus.ToString(),
            ["path"] = $"/orders/details/{order.Id}"
        };

        return SendToOthersAsync(
            order,
            $"Order {statusLabel}",
            $"Order #{order.OrderNumber} • PHP {totalAmount:N2}",
            data,
            actorUserId,
            cancellationToken);
    }

    public async Task SendNotificationAsync(
        IReadOnlyCollection<Guid> userIds,
        string title,
        string body,
        string? path,
        string kind,
        Guid? subjectId,
        CancellationToken cancellationToken)
    {
        if (userIds.Count == 0 || (!fcmClient.IsConfigured && !huaweiClient.IsConfigured))
        {
            return;
        }

        var tokens = await db.PushNotificationTokens
            .AsNoTracking()
            .Where(t => t.IsActive && userIds.Contains(t.UserId))
            .Select(t => new PushTarget(t.Token, t.Platform))
            .Distinct()
            .ToListAsync(cancellationToken);

        var data = new Dictionary<string, string>
        {
            ["type"] = PushTypes.Notification,
            ["kind"] = kind,
            ["path"] = path ?? "/notifications"
        };
        if (subjectId is not null)
        {
            data["subjectId"] = subjectId.Value.ToString();
        }

        await DeliverAsync(tokens, title, body, data, $"{kind} notification", cancellationToken);
    }

    private async Task SendToOthersAsync(
        Order order,
        string title,
        string body,
        Dictionary<string, string> data,
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        if (!fcmClient.IsConfigured && !huaweiClient.IsConfigured)
        {
            logger.LogInformation("Push notifications are not configured. Skipping send.");
            return;
        }

        var tokens = await db.PushNotificationTokens
            .AsNoTracking()
            .Where(t => t.IsActive)
            .Join(db.Users.Where(u => u.IsActive),
                token => token.UserId,
                user => user.Id,
                (token, user) => new { token, user.RoleId })
            .Join(db.UserRoles,
                joined => joined.RoleId,
                role => role.Id,
                (joined, role) => new { joined.token, role.Name })
            .Where(x => x.Name != AppRoles.AdminViewer)
            .Where(x => x.token.UserId != actorUserId)
            .Select(x => new PushTarget(x.token.Token, x.token.Platform))
            .Distinct()
            .ToListAsync(cancellationToken);

        await DeliverAsync(tokens, title, body, data, $"order {order.Id}", cancellationToken);
    }

    private sealed record PushTarget(string Token, string Platform);

    private async Task DeliverAsync(
        List<PushTarget> tokens,
        string title,
        string body,
        Dictionary<string, string> data,
        string subject,
        CancellationToken cancellationToken)
    {
        if (tokens.Count == 0)
        {
            return;
        }

        var fcmTokens = tokens
            .Where(t => !string.Equals(t.Platform, PlatformHuawei, StringComparison.OrdinalIgnoreCase))
            .Select(t => t.Token)
            .Distinct()
            .ToList();
        var huaweiTokens = tokens
            .Where(t => string.Equals(t.Platform, PlatformHuawei, StringComparison.OrdinalIgnoreCase))
            .Select(t => t.Token)
            .Distinct()
            .ToList();

        foreach (var token in fcmTokens)
        {
            try
            {
                await fcmClient.SendAsync(token, title, body, data, cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to send push notification for {Subject}.", subject);
            }
        }

        foreach (var token in huaweiTokens)
        {
            try
            {
                await huaweiClient.SendAsync(token, title, body, data, cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to send Huawei push notification for {Subject}.", subject);
            }
        }
    }
}
