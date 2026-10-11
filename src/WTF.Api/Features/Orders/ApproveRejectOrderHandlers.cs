using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

/// <summary>Staff accept an order a customer placed through their link: it joins the normal flow as Pending.</summary>
public record ApproveOrderCommand(Guid Id) : IRequest<OrderDto?>;

/// <summary>Staff finished preparing an accepted customer order: it is ready for pickup or for delivery.</summary>
public record MarkOrderReadyCommand(Guid Id) : IRequest<OrderDto?>;

/// <summary>Staff turn an order down. A reason is required and is shown to the customer.</summary>
public record RejectOrderCommand(Guid Id, string Reason) : IRequest<OrderDto?>;

public class ApproveOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier,
    ISender sender) : IRequestHandler<ApproveOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(ApproveOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order == null)
        {
            return null;
        }

        OrderDecision.EnsureWaiting(order, "accepted");

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        order.StatusId = (int)OrderStatusEnum.Pending;
        order.AcceptedAt = DateTime.UtcNow;
        order.UpdatedAt = order.AcceptedAt;
        order.UpdatedBy = userId;
        var chat = await ConversationStore.AddSystemMessageAsync(
            db, order, "Order accepted", userId, order.AcceptedAt.Value, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderApproved,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: new { StatusId = (int)OrderStatusEnum.PendingApproval },
            newValues: new { order.StatusId, order.OrderNumber },
            userId: userId,
            cancellationToken: cancellationToken);

        await OrderDecision.NotifyAsync(dashboardHub, order.Id, cancellationToken);
        await conversationNotifier.OrderChangedAsync(order, chat, cancellationToken);
        return await sender.Send(new GetOrderByIdQuery(order.Id), cancellationToken);
    }
}

public class RejectOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier,
    ISender sender) : IRequestHandler<RejectOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(RejectOrderCommand request, CancellationToken cancellationToken)
    {
        var reason = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new InvalidOperationException("A reason is required to reject an order.");
        }

        if (reason.Length > OrderInputValidation.NoteMaxLength)
        {
            throw new InvalidOperationException(
                $"The reason cannot be longer than {OrderInputValidation.NoteMaxLength} characters.");
        }

        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order == null)
        {
            return null;
        }

        OrderDecision.EnsureWaiting(order, "rejected");

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        order.StatusId = (int)OrderStatusEnum.Cancelled;
        order.RejectionReason = reason;
        order.UpdatedAt = DateTime.UtcNow;
        order.UpdatedBy = userId;
        var chat = await ConversationStore.AddSystemMessageAsync(
            db, order, $"Order rejected: {reason}", userId, order.UpdatedAt.Value, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderRejected,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: new { StatusId = (int)OrderStatusEnum.PendingApproval },
            newValues: new { order.StatusId, order.OrderNumber, Reason = reason },
            userId: userId,
            cancellationToken: cancellationToken);

        await OrderDecision.NotifyAsync(dashboardHub, order.Id, cancellationToken);
        await conversationNotifier.OrderChangedAsync(order, chat, cancellationToken);
        return await sender.Send(new GetOrderByIdQuery(order.Id), cancellationToken);
    }
}

public class MarkOrderReadyHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier,
    ISender sender) : IRequestHandler<MarkOrderReadyCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(MarkOrderReadyCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order == null)
        {
            return null;
        }

        if (order.Source != (byte)OrderSourceEnum.CustomerLink)
        {
            throw new InvalidOperationException("Only orders placed through a customer link can be marked ready.");
        }

        if (order.StatusId != (int)OrderStatusEnum.Pending)
        {
            throw new InvalidOperationException("Only accepted orders can be marked ready.");
        }

        if (order.ReadyAt.HasValue)
        {
            throw new InvalidOperationException("This order is already marked ready.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        order.ReadyAt = DateTime.UtcNow;
        order.UpdatedAt = order.ReadyAt;
        order.UpdatedBy = userId;
        var chat = await ConversationStore.AddSystemMessageAsync(
            db, order,
            order.FulfillmentType == (byte)FulfillmentTypeEnum.Delivery
                ? "Order is ready for delivery"
                : "Order is ready for pickup",
            userId, order.ReadyAt.Value, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderMarkedReady,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            newValues: new { order.OrderNumber, order.FulfillmentType, order.ReadyAt },
            userId: userId,
            cancellationToken: cancellationToken);

        await OrderDecision.NotifyAsync(dashboardHub, order.Id, cancellationToken);
        await conversationNotifier.OrderChangedAsync(order, chat, cancellationToken);
        return await sender.Send(new GetOrderByIdQuery(order.Id), cancellationToken);
    }
}

internal static class OrderDecision
{
    /// <summary>Only an order that is still waiting for approval can be accepted or rejected, and only once.</summary>
    public static void EnsureWaiting(WTF.Domain.Entities.Order order, string verb)
    {
        if (order.StatusId != (int)OrderStatusEnum.PendingApproval)
        {
            throw new InvalidOperationException($"Only orders waiting for approval can be {verb}.");
        }
    }

    public static async Task NotifyAsync(IHubContext<DashboardHub> hub, Guid orderId, CancellationToken cancellationToken)
    {
        await hub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);
        await hub.Clients.Group(HubNames.Groups.DashboardViewers)
            .SendAsync(HubNames.Events.OrderUpdated, orderId, cancellationToken);
    }
}
