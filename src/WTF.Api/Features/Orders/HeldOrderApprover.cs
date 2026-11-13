using Microsoft.AspNetCore.SignalR;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public interface IHeldOrderApprover
{
    Task ApproveAsync(Order order, Guid userId, CancellationToken cancellationToken);
}

public class HeldOrderApprover(
    WTFDbContext db,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService,
    IConversationNotifier conversationNotifier,
    IOrderStockService stockService) : IHeldOrderApprover
{
    public async Task ApproveAsync(Order order, Guid userId, CancellationToken cancellationToken)
    {
        HeldOrderDecision.EnsureHeld(order, "approved");

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await HeldOrderDecision.ClaimAsync(db, order, OrderStatusEnum.Completed, "approved", cancellationToken);
        order.StatusId = (int)OrderStatusEnum.Completed;
        order.UpdatedAt = DateTime.UtcNow;
        order.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        // The goods were handed over when the order was sold, so approving it takes the stock whatever the balance is.
        var stock = await stockService.DeductForOrderAsync(order.Id, userId, new StockDeductionOptions(BlockWhenShort: false), cancellationToken);
        await StockShortfallReasons.SaveAsync(db, order, stock.Shortfalls, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderReviewApproved,
            entityType: AuditEntityType.Order,
            entityId: order.Id.ToString(),
            oldValues: new { StatusId = (int)OrderStatusEnum.PendingReview },
            newValues: new { order.StatusId, order.OrderNumber, order.QuotedTotal, order.ReviewReasons },
            userId: userId,
            cancellationToken: cancellationToken);

        await OrderDecision.NotifyAsync(dashboardHub, order, cancellationToken);
        await conversationNotifier.OrderChangedAsync(order, null, cancellationToken);
    }
}
