using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Notifications;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Waste;

internal static class WasteReviewNotifications
{
    public static async Task ResolveAsync(
        WTFDbContext db,
        INotificationService? notifications,
        Guid wasteId,
        DateTime readAt,
        CancellationToken cancellationToken)
    {
        var unread = db.Notifications.Where(n =>
            n.Kind == NotificationKinds.WasteReview && n.SubjectId == wasteId && n.ReadAt == null);

        var userIds = await unread.Select(n => n.UserId).Distinct().ToListAsync(cancellationToken);
        if (userIds.Count > 0)
        {
            if (db.Database.IsRelational())
            {
                await unread.ExecuteUpdateAsync(setters => setters.SetProperty(n => n.ReadAt, readAt), cancellationToken);
            }
            else
            {
                var rows = await unread.ToListAsync(cancellationToken);
                foreach (var row in rows)
                {
                    row.ReadAt = readAt;
                }

                await db.SaveChangesAsync(cancellationToken);
            }
        }

        if (notifications is null)
        {
            return;
        }

        // Reviewers refresh their pending-review count on NotificationsChanged, even those without a row.
        var reviewers = await db.Users
            .Where(u => u.IsActive && (u.Role.Name == AppRoles.SuperAdmin || u.Role.Name == AppRoles.Admin))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);

        var recipients = userIds.Union(reviewers).ToList();
        if (recipients.Count > 0)
        {
            await notifications.CountsChangedAsync(recipients, cancellationToken);
        }
    }
}
