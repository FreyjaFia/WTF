using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Kitchen.DTOs;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Calculations.Kitchen;
using WTF.Domain.Data;

namespace WTF.Api.Features.Kitchen;

public record MarkKitchenChangeSeenCommand(Guid Id) : IRequest<KitchenOrderDto?>;

public record DismissKitchenOrderCommand(Guid Id) : IRequest<KitchenOrderDto?>;

public class MarkKitchenChangeSeenHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IConversationNotifier conversationNotifier) : IRequestHandler<MarkKitchenChangeSeenCommand, KitchenOrderDto?>
{
    public async Task<KitchenOrderDto?> Handle(MarkKitchenChangeSeenCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        if (order.KitchenStatus is null)
        {
            throw new InvalidOperationException("This order is not on the kitchen board.");
        }

        if (order.KitchenChangeNote is not null || order.KitchenChangeKind is not null)
        {
            order.KitchenChangeNote = null;
            order.KitchenChangeKind = null;
            order.KitchenUpdatedBy = httpContextAccessor.HttpContext!.User.GetUserId();
            await db.SaveChangesAsync(cancellationToken);
            await KitchenNotify.OrderChangedAsync(dashboardHub, conversationNotifier, order, cancellationToken);
        }

        return await KitchenOrderLookup.OneAsync(db, order.Id, cancellationToken);
    }
}

public class DismissKitchenOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IConversationNotifier conversationNotifier) : IRequestHandler<DismissKitchenOrderCommand, KitchenOrderDto?>
{
    public async Task<KitchenOrderDto?> Handle(DismissKitchenOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        if (!KitchenBoardRules.IsStopMakingCard(order.StatusId, order.KitchenStatus, order.KitchenDismissedAt.HasValue))
        {
            throw new InvalidOperationException("Only a cancelled order the kitchen had started can be dismissed.");
        }

        order.KitchenDismissedAt = DateTime.UtcNow;
        order.KitchenUpdatedBy = httpContextAccessor.HttpContext!.User.GetUserId();
        await db.SaveChangesAsync(cancellationToken);
        await KitchenNotify.OrderChangedAsync(dashboardHub, conversationNotifier, order, cancellationToken);

        return await KitchenOrderLookup.OneAsync(db, order.Id, cancellationToken);
    }
}
