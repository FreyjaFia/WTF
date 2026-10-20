using Microsoft.AspNetCore.SignalR;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Notifications;

public record NotificationMessage(
    string Kind,
    byte Severity,
    string Title,
    string Body,
    string? Path = null,
    Guid? SubjectId = null,
    string? Data = null);

public interface INotificationService
{
    Task NotifyAsync(IReadOnlyCollection<Guid> userIds, NotificationMessage message, CancellationToken cancellationToken);

    Task AnnounceAsync(IReadOnlyCollection<Guid> userIds, NotificationMessage message, CancellationToken cancellationToken);

    Task CountsChangedAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken);

    Task StockChangedAsync(Guid itemId, CancellationToken cancellationToken);
}

// The one producer of notifications. Saves one row per person, then tells their open screens (live) and their devices
// (push). A kind keeps its own rules (who is told, how not to repeat, the wording) and calls this.
public sealed class NotificationService(
    WTFDbContext db,
    IPushNotificationService pushNotifications,
    IHubContext<NotificationHub> hub) : INotificationService
{
    public async Task NotifyAsync(IReadOnlyCollection<Guid> userIds, NotificationMessage message, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        db.Notifications.AddRange(userIds.Distinct().Select(userId => new Notification
        {
            UserId = userId,
            Kind = message.Kind,
            Severity = message.Severity,
            Title = message.Title,
            Body = message.Body,
            Path = message.Path,
            SubjectId = message.SubjectId,
            Data = message.Data,
            CreatedAt = now
        }));
        await db.SaveChangesAsync(cancellationToken);

        await AnnounceAsync(userIds, message, cancellationToken);
    }

    // For rows that were saved or lifted elsewhere: tell the open screens and the devices.
    public async Task AnnounceAsync(IReadOnlyCollection<Guid> userIds, NotificationMessage message, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
        {
            return;
        }

        await CountsChangedAsync(userIds, cancellationToken);

        try
        {
            await pushNotifications.SendNotificationAsync(
                userIds, message.Title, message.Body, message.Path, message.Kind, message.SubjectId, cancellationToken);
        }
        catch (Exception)
        {
            // The saved list is the record; a failed push never undoes the change that caused the notification.
        }
    }

    public async Task CountsChangedAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken)
    {
        try
        {
            foreach (var userId in userIds.Distinct())
            {
                await hub.Clients.Group(HubNames.Groups.User(userId))
                    .SendAsync(HubNames.Events.NotificationsChanged, cancellationToken);
            }
        }
        catch (Exception)
        {
            // Live updates are a convenience; the next refresh shows the same numbers.
        }
    }

    public async Task StockChangedAsync(Guid itemId, CancellationToken cancellationToken)
    {
        try
        {
            await hub.Clients.Group(HubNames.Groups.StockViewers)
                .SendAsync(HubNames.Events.StockChanged, itemId, cancellationToken);
        }
        catch (Exception)
        {
            // Live updates are a convenience.
        }
    }
}
