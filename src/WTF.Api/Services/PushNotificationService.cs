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

    Task SendOrderStatusChangedAsync(
        Order order,
        decimal totalAmount,
        OrderStatusEnum newStatus,
        Guid actorUserId,
        CancellationToken cancellationToken);
}

public sealed class PushNotificationService(
    WTFDbContext db,
    IFcmPushClient fcmClient,
    IHuaweiPushClient huaweiClient,
    ILogger<PushNotificationService> logger) : IPushNotificationService
{
    private const string PlatformHuawei = "huawei";

    public async Task SendOrderCreatedAsync(
        Order order,
        decimal totalAmount,
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

        var title = "New order created";
        var body = $"Order #{order.OrderNumber} \u2022 PHP {totalAmount:N2}";
        var data = new Dictionary<string, string>
        {
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber.ToString(),
            ["path"] = $"/orders/editor/{order.Id}"
        };

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

    public async Task SendOrderStatusChangedAsync(
        Order order,
        decimal totalAmount,
        OrderStatusEnum newStatus,
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        if (!fcmClient.IsConfigured && !huaweiClient.IsConfigured)
        {
            logger.LogInformation("Push notifications are not configured. Skipping send.");
            return;
        }

        var statusLabel = newStatus switch
        {
            OrderStatusEnum.Completed => "completed",
            OrderStatusEnum.Cancelled => "cancelled",
            OrderStatusEnum.Refunded => "refunded",
            _ => "updated"
        };

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

        var title = $"Order {statusLabel}";
        var body = $"Order #{order.OrderNumber} \u2022 PHP {totalAmount:N2}";
        var data = new Dictionary<string, string>
        {
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber.ToString(),
            ["status"] = newStatus.ToString(),
            ["path"] = $"/orders/details/{order.Id}"
        };

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
