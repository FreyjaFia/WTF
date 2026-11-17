using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Kitchen.DTOs;
using WTF.Api.Features.Orders;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Calculations.Kitchen;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Kitchen;

public record MoveKitchenOrderCommand(Guid Id, KitchenState To, KitchenState? From = null, bool BringBack = false)
    : IRequest<KitchenOrderDto?>;

public class MoveKitchenOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier,
    ISender sender) : IRequestHandler<MoveKitchenOrderCommand, KitchenOrderDto?>
{
    public async Task<KitchenOrderDto?> Handle(MoveKitchenOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        if (order.KitchenStatus is not { } stored || !KitchenTracking.CanStart(order.StatusId))
        {
            throw new InvalidOperationException("This order is not on the kitchen board.");
        }

        var current = (KitchenState)stored;
        var move = request.From.HasValue && request.To > request.From.Value
            ? KitchenBoardRules.DecideForward(current, request.To)
            : KitchenBoardRules.Decide(current, request.To, request.BringBack);

        if (move == KitchenMove.Refused)
        {
            throw new InvalidOperationException("The order cannot go to that step from where it is.");
        }

        if (move == KitchenMove.Moved)
        {
            await ApplyAsync(order, current, request.To, cancellationToken);
        }

        return await KitchenOrderLookup.OneAsync(db, order.Id, cancellationToken);
    }

    private async Task ApplyAsync(Order order, KitchenState from, KitchenState to, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;

        if (to >= KitchenState.Ready && order.ReadyAt is null)
        {
            // Ready on a customer link order is the same action as the Ready button on the order: the customer's page and chat follow.
            if (order.Source == (byte)Orders.Enums.OrderSourceEnum.CustomerLink && order.StatusId == (int)Orders.Enums.OrderStatusEnum.Pending)
            {
                await sender.Send(new MarkOrderReadyCommand(order.Id), cancellationToken);
            }

            order.ReadyAt ??= now;
        }
        else if (to < KitchenState.Ready)
        {
            order.ReadyAt = null;
        }

        order.KitchenStatus = (byte)to;
        order.KitchenUpdatedBy = userId;
        order.KitchenStartedAt = to >= KitchenState.Preparing ? order.KitchenStartedAt ?? now : null;
        order.KitchenServedAt = to == KitchenState.Served ? now : null;
        if (to == KitchenState.Served)
        {
            order.KitchenChangeNote = null;
            order.KitchenChangeKind = null;
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderKitchenStatusChanged,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: new { KitchenStatus = from.ToString() },
            newValues: new { order.OrderNumber, KitchenStatus = to.ToString() },
            userId: userId,
            cancellationToken: cancellationToken);

        await KitchenNotify.OrderChangedAsync(dashboardHub, conversationNotifier, order, cancellationToken);
    }
}
