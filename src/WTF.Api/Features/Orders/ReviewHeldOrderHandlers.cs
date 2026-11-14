using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record SeniorPwdIdFix(Guid DiscountId, string IdNumber, string CustomerName);

public record ApproveHeldOrderCommand(Guid Id, List<SeniorPwdIdFix>? IdFixes = null) : IRequest<OrderDto?>;

public static class HeldRejectStockOutcomes
{
    public const string None = "none";
    public const string Waste = "waste";
}

public record RejectHeldOrderCommand(Guid Id, string Reason, string? StockOutcome = null) : IRequest<OrderDto?>;

public class ApproveHeldOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHeldOrderApprover approver,
    ISender sender) : IRequestHandler<ApproveHeldOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(ApproveHeldOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        await FillMissingSeniorPwdIdsAsync(order, request.IdFixes, cancellationToken);
        await approver.ApproveAsync(order, userId, cancellationToken);
        return await sender.Send(new GetOrderByIdQuery(order.Id), cancellationToken);
    }

    private async Task FillMissingSeniorPwdIdsAsync(Order order, List<SeniorPwdIdFix>? fixes, CancellationToken cancellationToken)
    {
        if (fixes is null || fixes.Count == 0)
        {
            return;
        }

        HeldOrderDecision.EnsureHeld(order, "approved");

        var persons = await db.OrderSeniorPwdDiscounts.Where(d => d.OrderId == order.Id).ToListAsync(cancellationToken);
        foreach (var fix in fixes)
        {
            var person = persons.FirstOrDefault(p => p.Id == fix.DiscountId)
                ?? throw new InvalidOperationException("That Senior/PWD discount is not on this order.");
            var idNumber = fix.IdNumber?.Trim() ?? string.Empty;
            var name = fix.CustomerName?.Trim() ?? string.Empty;
            if (idNumber.Length == 0 || idNumber.Length > 50 || idNumber.Any(char.IsControl))
            {
                throw new InvalidOperationException("The ID number is not valid (50 characters at most).");
            }

            if (name.Length == 0 || name.Length > 100 || name.Any(char.IsControl))
            {
                throw new InvalidOperationException("The name on the ID is not valid (100 characters at most).");
            }

            person.IdNumber = idNumber;
            person.CustomerName = name;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}

public class RejectHeldOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier,
    ISender sender,
    IOrderStockService stockService) : IRequestHandler<RejectHeldOrderCommand, OrderDto?>
{
    public async Task<OrderDto?> Handle(RejectHeldOrderCommand request, CancellationToken cancellationToken)
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

        var outcome = request.StockOutcome?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(outcome) && outcome is not (HeldRejectStockOutcomes.None or HeldRejectStockOutcomes.Waste))
        {
            throw new InvalidOperationException("The stock outcome must be waste or none.");
        }

        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        HeldOrderDecision.EnsureHeld(order, "rejected");

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await HeldOrderDecision.ClaimAsync(db, order, OrderStatusEnum.Cancelled, "rejected", cancellationToken);

        order.StatusId = (int)OrderStatusEnum.Cancelled;
        order.RejectionReason = reason;
        order.Note = reason;
        order.UpdatedAt = DateTime.UtcNow;
        order.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        // The goods were handed over when the sale was made, so the stock they used is waste (same movement rows as a void).
        var wasted = outcome == HeldRejectStockOutcomes.Waste;
        if (wasted)
        {
            await stockService.WasteForOrderAsync(order.Id, userId, "Rejected offline sale, goods handed over", cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderReviewRejected,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: new { StatusId = (int)OrderStatusEnum.PendingReview },
            newValues: new { order.StatusId, order.OrderNumber, Reason = reason, order.ReviewReasons, StockOutcome = wasted ? HeldRejectStockOutcomes.Waste : HeldRejectStockOutcomes.None },
            userId: userId,
            cancellationToken: cancellationToken);

        await OrderDecision.NotifyAsync(dashboardHub, order, cancellationToken);
        await conversationNotifier.OrderChangedAsync(order, null, cancellationToken);
        return await sender.Send(new GetOrderByIdQuery(order.Id), cancellationToken);
    }
}

internal static class HeldOrderDecision
{
    public static async Task ClaimAsync(WTFDbContext db, Order order, OrderStatusEnum to, string verb, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            return;
        }

        // A second reviewer waits on the row lock, then finds the order already decided.
        var claimed = await db.Orders
            .Where(o => o.Id == order.Id && o.StatusId == (int)OrderStatusEnum.PendingReview)
            .ExecuteUpdateAsync(setters => setters.SetProperty(o => o.StatusId, (int)to), cancellationToken);
        if (claimed != 1)
        {
            throw new InvalidOperationException($"Only orders waiting for review can be {verb}.");
        }
    }

    public static void EnsureHeld(Order order, string verb)
    {
        if (order.StatusId != (int)OrderStatusEnum.PendingReview)
        {
            throw new InvalidOperationException($"Only orders waiting for review can be {verb}.");
        }
    }
}
