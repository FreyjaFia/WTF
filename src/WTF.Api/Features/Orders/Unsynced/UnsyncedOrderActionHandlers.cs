using MediatR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Text;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record RetryUnsyncedOrderCommand(Guid Id) : IRequest<UnsyncedOrderRetryResultDto?>;

public record NoteOnlyUnsyncedOrderCommand(Guid Id) : IRequest<UnsyncedOrderDetailDto?>;

public record DiscardUnsyncedOrderCommand(Guid Id, string Reason) : IRequest<UnsyncedOrderDetailDto?>;

public class RetryUnsyncedOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    ISender sender,
    IAuditService auditService) : IRequestHandler<RetryUnsyncedOrderCommand, UnsyncedOrderRetryResultDto?>
{
    public async Task<UnsyncedOrderRetryResultDto?> Handle(RetryUnsyncedOrderCommand request, CancellationToken cancellationToken)
    {
        var row = await db.UnsyncedOrders.AsNoTracking().FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (row is null)
        {
            return null;
        }

        UnsyncedOrderRules.EnsureOpen(row, "retried");
        var quoted = UnsyncedOrderMapper.ReadOrder(row)
            ?? throw new InvalidOperationException("The quoted order cannot be read, so it cannot be retried. Save it as a note or discard it.");

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var results = await sender.Send(
            new SyncOfflineOrdersCommand([quoted with { ActorUserId = row.CashierUserId, OfflineLocalId = row.OfflineLocalId }]),
            cancellationToken);
        var result = results.Single();

        var current = await db.UnsyncedOrders.FirstAsync(u => u.Id == row.Id, cancellationToken);
        if (result.Error is null && result.OrderId.HasValue)
        {
            if (current.StatusId == (byte)UnsyncedOrderStatusEnum.Open)
            {
                current.StatusId = (byte)UnsyncedOrderStatusEnum.Resolved;
                current.Resolution = (byte)UnsyncedOrderResolutionEnum.Retried;
                current.ResolvedBy = userId;
                current.ResolvedAt = DateTime.UtcNow;
                current.ResultingOrderId = result.OrderId;
                await db.SaveChangesAsync(cancellationToken);
            }

            await auditService.LogAsync(
                action: AuditAction.UnsyncedOrderRetried,
                entityType: AuditEntityType.UnsyncedOrder,
                entityId: row.Id.ToString(),
                oldValues: new { Status = UnsyncedOrderStatusEnum.Open.ToString(), row.ErrorText },
                newValues: new { Status = UnsyncedOrderStatusEnum.Resolved.ToString(), Resolution = UnsyncedOrderResolutionEnum.Retried.ToString(), row.OfflineLocalId, result.OrderId, result.OrderNumber },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        var names = await UnsyncedOrderMapper.UserNamesAsync(db, [current], cancellationToken);
        return new UnsyncedOrderRetryResultDto(
            result.Error is null,
            result.Error,
            result.OrderId,
            result.OrderNumber,
            UnsyncedOrderMapper.ToDto(current, names, quoted.Items.Count));
    }
}

public class NoteOnlyUnsyncedOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IHubContext<DashboardHub> dashboardHub,
    IAuditService auditService) : IRequestHandler<NoteOnlyUnsyncedOrderCommand, UnsyncedOrderDetailDto?>
{
    public const string NoteHeading = "Unsynced offline sale recorded for the cash drawer";

    public async Task<UnsyncedOrderDetailDto?> Handle(NoteOnlyUnsyncedOrderCommand request, CancellationToken cancellationToken)
    {
        var row = await db.UnsyncedOrders.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (row is null)
        {
            return null;
        }

        UnsyncedOrderRules.EnsureOpen(row, "saved as a note");
        var quoted = UnsyncedOrderMapper.ReadOrder(row);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var detail = await UnsyncedOrderMapper.ToDetailAsync(db, row, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await UnsyncedOrderRules.ClaimAsync(db, row, "saved as a note", cancellationToken);

        // The lines may name a product that no longer exists, so they stay in the note and in the unsynced row, not as order lines.
        // The order is Cancelled: it is not a sale, but it keeps the cash the register took (payment, amount received, change).
        var note = BuildNote(row, detail.Lines);
        var order = new Order
        {
            CreatedAt = row.DeviceCreatedAt ?? row.ReceivedAt,
            CreatedBy = row.CashierUserId,
            UpdatedAt = DateTime.UtcNow,
            UpdatedBy = userId,
            CustomerId = null,
            StatusId = (int)OrderStatusEnum.Cancelled,
            PaymentMethodId = quoted?.PaymentMethod is { } method ? (int)method : null,
            AmountReceived = quoted?.AmountReceived,
            ChangeAmount = quoted?.ChangeAmount,
            Tips = quoted?.Tips,
            Note = note,
            RejectionReason = note,
            Source = (byte)OrderSourceEnum.Pos,
            QuotedTotal = row.QuotedTotal,
            OfflineLocalId = row.OfflineLocalId,
            CatalogSyncedAt = quoted?.CatalogSyncedAt?.ToUniversalTime()
        };
        db.Orders.Add(order);

        row.StatusId = (byte)UnsyncedOrderStatusEnum.Resolved;
        row.Resolution = (byte)UnsyncedOrderResolutionEnum.NoteOnly;
        row.ResolvedBy = userId;
        row.ResolvedAt = DateTime.UtcNow;
        row.ResultingOrder = order;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UnsyncedOrderNoteOnly,
            entityType: AuditEntityType.UnsyncedOrder,
            entityId: row.Id.ToString(),
            oldValues: new { Status = UnsyncedOrderStatusEnum.Open.ToString(), row.ErrorText },
            newValues: new { Status = UnsyncedOrderStatusEnum.Resolved.ToString(), Resolution = UnsyncedOrderResolutionEnum.NoteOnly.ToString(), row.OfflineLocalId, OrderId = order.Id, order.OrderNumber, row.QuotedTotal },
            userId: userId,
            cancellationToken: cancellationToken);

        await dashboardHub.Clients.Group(HubNames.Groups.DashboardViewers(order.TenantId))
            .SendAsync(HubNames.Events.DashboardUpdated, cancellationToken);

        return await UnsyncedOrderMapper.ToDetailAsync(db, row, cancellationToken);
    }

    private static string BuildNote(UnsyncedOrder row, List<UnsyncedOrderLineDto> lines)
    {
        var text = new StringBuilder(NoteHeading).Append(". Queue number ").Append(row.OfflineLocalId).Append('.');
        if (row.QuotedTotal.HasValue)
        {
            text.Append(" Quoted total ").Append(row.QuotedTotal.Value.ToString("0.00", CultureInfo.InvariantCulture)).Append('.');
        }

        if (lines.Count > 0)
        {
            text.Append(" Lines: ").Append(string.Join("; ", lines.Select(Describe))).Append('.');
        }

        var result = text.ToString();
        return result.Length <= OrderInputValidation.NoteMaxLength ? result : result[..(OrderInputValidation.NoteMaxLength - 3)] + "...";
    }

    private static string Describe(UnsyncedOrderLineDto line)
    {
        var price = line.QuotedPrice.HasValue ? " @ " + line.QuotedPrice.Value.ToString("0.00", CultureInfo.InvariantCulture) : string.Empty;
        var addOns = line.AddOns.Count > 0 ? " (+ " + string.Join(", ", line.AddOns.Select(a => $"{a.Quantity} x {a.ProductName ?? "unknown product"}")) + ")" : string.Empty;
        return $"{line.Quantity} x {line.ProductName ?? "unknown product"}{price}{addOns}";
    }
}

public class DiscardUnsyncedOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<DiscardUnsyncedOrderCommand, UnsyncedOrderDetailDto?>
{
    public async Task<UnsyncedOrderDetailDto?> Handle(DiscardUnsyncedOrderCommand request, CancellationToken cancellationToken)
    {
        var reason = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new InvalidOperationException("A reason is required to discard an order.");
        }

        if (reason.Length > OrderInputValidation.NoteMaxLength)
        {
            throw new InvalidOperationException(
                $"The reason cannot be longer than {OrderInputValidation.NoteMaxLength} characters.");
        }

        var row = await db.UnsyncedOrders.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (row is null)
        {
            return null;
        }

        UnsyncedOrderRules.EnsureOpen(row, "discarded");
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await UnsyncedOrderRules.ClaimAsync(db, row, "discarded", cancellationToken);

        row.StatusId = (byte)UnsyncedOrderStatusEnum.Resolved;
        row.Resolution = (byte)UnsyncedOrderResolutionEnum.Discarded;
        row.DiscardReason = reason;
        row.ResolvedBy = userId;
        row.ResolvedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UnsyncedOrderDiscarded,
            entityType: AuditEntityType.UnsyncedOrder,
            entityId: row.Id.ToString(),
            oldValues: new { Status = UnsyncedOrderStatusEnum.Open.ToString(), row.ErrorText },
            newValues: new { Status = UnsyncedOrderStatusEnum.Resolved.ToString(), Resolution = UnsyncedOrderResolutionEnum.Discarded.ToString(), row.OfflineLocalId, Reason = reason, row.QuotedTotal },
            userId: userId,
            cancellationToken: cancellationToken);

        return await UnsyncedOrderMapper.ToDetailAsync(db, row, cancellationToken);
    }
}

internal static class UnsyncedOrderRules
{
    public static void EnsureOpen(UnsyncedOrder row, string verb)
    {
        if (row.StatusId != (byte)UnsyncedOrderStatusEnum.Open)
        {
            throw new InvalidOperationException($"Only open unsynced orders can be {verb}.");
        }
    }

    public static async Task ClaimAsync(WTFDbContext db, UnsyncedOrder row, string verb, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            return;
        }

        // A second Admin waits on the row lock, then finds the order already decided.
        var claimed = await db.UnsyncedOrders
            .Where(u => u.Id == row.Id && u.StatusId == (byte)UnsyncedOrderStatusEnum.Open)
            .ExecuteUpdateAsync(setters => setters.SetProperty(u => u.StatusId, (byte)UnsyncedOrderStatusEnum.Resolved), cancellationToken);
        if (claimed != 1)
        {
            throw new InvalidOperationException($"Only open unsynced orders can be {verb}.");
        }
    }
}
