using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetStockNotificationsQuery(bool UnreadOnly = false, int Page = 1, int PageSize = 25)
    : IRequest<StockNotificationListDto>;

public record MarkStockNotificationsReadCommand(List<Guid>? Ids = null) : IRequest<int>;

public class GetStockNotificationsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetStockNotificationsQuery, StockNotificationListDto>
{
    private const int MaxPageSize = 100;

    public async Task<StockNotificationListDto> Handle(GetStockNotificationsQuery request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);

        var mine = db.StockNotifications.AsNoTracking().Where(n => n.UserId == userId);
        var unread = await mine.CountAsync(n => n.ReadAt == null, cancellationToken);
        var shown = request.UnreadOnly ? mine.Where(n => n.ReadAt == null) : mine;
        var total = await shown.CountAsync(cancellationToken);

        var rows = await shown
            .OrderByDescending(n => n.CreatedAt)
            .ThenByDescending(n => n.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(n => new
            {
                n.Id,
                n.ItemId,
                ItemName = n.Item.Name,
                n.Status,
                n.Quantity,
                n.Title,
                n.Body,
                n.CreatedAt,
                IsRead = n.ReadAt != null
            })
            .ToListAsync(cancellationToken);

        return new StockNotificationListDto(
            rows.Select(n => new StockNotificationDto(
                n.Id, n.ItemId, n.ItemName, ((StockStatus)n.Status).ToString(), n.Quantity, n.Title, n.Body, n.CreatedAt, n.IsRead)).ToList(),
            total,
            unread);
    }
}

public class MarkStockNotificationsReadHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<MarkStockNotificationsReadCommand, int>
{
    public async Task<int> Handle(MarkStockNotificationsReadCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var unread = db.StockNotifications.Where(n => n.UserId == userId && n.ReadAt == null);
        if (request.Ids is { Count: > 0 })
        {
            var ids = request.Ids;
            unread = unread.Where(n => ids.Contains(n.Id));
        }

        var now = DateTime.UtcNow;
        foreach (var notification in await unread.ToListAsync(cancellationToken))
        {
            notification.ReadAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return await db.StockNotifications.CountAsync(n => n.UserId == userId && n.ReadAt == null, cancellationToken);
    }
}
