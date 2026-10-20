using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Notifications.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Notifications;

public record GetNotificationsQuery(string? Kind = null, bool UnreadOnly = false, int Page = 1, int PageSize = 25)
    : IRequest<NotificationListDto>;

public record GetNotificationCountsQuery : IRequest<NotificationCountsDto>;

public record MarkNotificationsReadCommand(List<Guid>? Ids = null, string? Kind = null) : IRequest<NotificationCountsDto>;

public static class NotificationCounts
{
    public static async Task<NotificationCountsDto> ForAsync(WTFDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var byKind = await db.Notifications
            .AsNoTracking()
            .Where(n => n.UserId == userId && n.ReadAt == null)
            .GroupBy(n => n.Kind)
            .Select(g => new { Kind = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        return new NotificationCountsDto(byKind.Sum(k => k.Count), byKind.ToDictionary(k => k.Kind, k => k.Count));
    }
}

public class GetNotificationsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetNotificationsQuery, NotificationListDto>
{
    private const int MaxPageSize = 100;

    public async Task<NotificationListDto> Handle(GetNotificationsQuery request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);

        var mine = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
        var shown = string.IsNullOrWhiteSpace(request.Kind) ? mine : mine.Where(n => n.Kind == request.Kind);
        if (request.UnreadOnly)
        {
            shown = shown.Where(n => n.ReadAt == null);
        }

        var total = await shown.CountAsync(cancellationToken);
        var rows = await shown
            .OrderByDescending(n => n.CreatedAt)
            .ThenByDescending(n => n.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(n => new
            {
                n.Id,
                n.Kind,
                n.Severity,
                n.Title,
                n.Body,
                n.Path,
                n.SubjectId,
                n.CreatedAt,
                IsRead = n.ReadAt != null,
                n.ReminderCount
            })
            .ToListAsync(cancellationToken);

        var counts = await NotificationCounts.ForAsync(db, userId, cancellationToken);
        return new NotificationListDto(
            rows.Select(n => new NotificationDto(
                n.Id, n.Kind, SeverityName(n.Severity), n.Title, n.Body, n.Path, n.SubjectId, n.CreatedAt, n.IsRead, n.ReminderCount)).ToList(),
            total,
            counts.UnreadCount,
            counts.UnreadByKind);
    }

    private static string SeverityName(byte severity) => severity switch
    {
        NotificationSeverity.Critical => "Critical",
        NotificationSeverity.Warning => "Warning",
        _ => "Info"
    };
}

public class GetNotificationCountsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetNotificationCountsQuery, NotificationCountsDto>
{
    public Task<NotificationCountsDto> Handle(GetNotificationCountsQuery request, CancellationToken cancellationToken) =>
        NotificationCounts.ForAsync(db, httpContextAccessor.HttpContext!.User.GetUserId(), cancellationToken);
}

public class MarkNotificationsReadHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    INotificationService notifications) : IRequestHandler<MarkNotificationsReadCommand, NotificationCountsDto>
{
    public async Task<NotificationCountsDto> Handle(MarkNotificationsReadCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var unread = db.Notifications.Where(n => n.UserId == userId && n.ReadAt == null);
        if (request.Ids is { Count: > 0 })
        {
            var ids = request.Ids;
            unread = unread.Where(n => ids.Contains(n.Id));
        }

        if (!string.IsNullOrWhiteSpace(request.Kind))
        {
            unread = unread.Where(n => n.Kind == request.Kind);
        }

        var now = DateTime.UtcNow;
        var changed = false;
        foreach (var notification in await unread.ToListAsync(cancellationToken))
        {
            notification.ReadAt = now;
            changed = true;
        }

        if (changed)
        {
            await db.SaveChangesAsync(cancellationToken);

            // Other devices of the same person drop their count too.
            await notifications.CountsChangedAsync([userId], cancellationToken);
        }

        return await NotificationCounts.ForAsync(db, userId, cancellationToken);
    }
}
