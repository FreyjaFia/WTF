using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Calculations.Kitchen;
using WTF.Domain.Data;

namespace WTF.Api.Features.Kitchen;

public record ClearOldKitchenOrdersCommand : IRequest<int>;

public class ClearOldKitchenOrdersHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier) : IRequestHandler<ClearOldKitchenOrdersCommand, int>
{
    public async Task<int> Handle(ClearOldKitchenOrdersCommand request, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var timeZone = await KitchenBoardLoader.ShopTimeZoneAsync(db, cancellationToken);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var open = await db.Orders
            .Where(o => o.KitchenStatus != null && o.KitchenStatus < (byte)KitchenState.Served)
            .ToListAsync(cancellationToken);

        var stale = open
            .Where(o => KitchenBoardRules.IsOnBoard(o.StatusId, o.KitchenStatus) && KitchenBoardRules.IsStale(o.CreatedAt, now, timeZone))
            .ToList();

        foreach (var order in stale)
        {
            var from = (KitchenState)order.KitchenStatus!.Value;
            order.KitchenStatus = (byte)KitchenState.Served;
            order.KitchenServedAt = now;
            order.KitchenUpdatedBy = userId;
            order.KitchenChangeNote = null;
            order.KitchenChangeKind = null;

            await auditService.LogAsync(
                action: AuditAction.OrderKitchenStatusChanged,
                entityType: AuditEntityType.Order,
                entityId: order.Id.ToString(),
                oldValues: new { KitchenStatus = from.ToString() },
                newValues: new { order.OrderNumber, KitchenStatus = nameof(KitchenState.Served), ClearedAsOld = true },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        if (stale.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            await KitchenNotify.OrderChangedAsync(dashboardHub, conversationNotifier, stale[0], cancellationToken);
        }

        return stale.Count;
    }
}
