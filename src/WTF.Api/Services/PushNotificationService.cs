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

    Task SendOrderStatusChangedAsync(
        Order order,
        decimal totalAmount,
        OrderStatusEnum newStatus,
        Guid actorUserId,
        CancellationToken cancellationToken,
        bool isOverride = false);
}

/// <summary>Values of the <c>type</c> field in push data, so the app can route each kind of notification.</summary>
public static class PushTypes
{
    public const string OnlineOrder = "online-order";
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
            string.Join(" - ", parts),
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
            .Select(x => new { x.token.Token, x.token.Platform })
            .Distinct()
            .ToListAsync(cancellationToken);

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
                logger.LogWarning(ex, "Failed to send push notification for order {OrderId}.", order.Id);
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
                logger.LogWarning(ex, "Failed to send Huawei push notification for order {OrderId}.", order.Id);
            }
        }
    }
}
