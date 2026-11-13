using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal static class UnsyncedOrderRecorder
{
    public const int MaxJsonBytes = 64 * 1024;

    private const int ErrorMaxLength = 500;

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // Recording is a courtesy to the Admin: it never changes what the device is told and never throws.
    public static async Task RecordFailureAsync(
        WTFDbContext db,
        IHttpContextAccessor httpContextAccessor,
        CreateOrderCommand order,
        string localId,
        Exception failure,
        CancellationToken cancellationToken)
    {
        try
        {
            var cashierId = httpContextAccessor.HttpContext?.User.GetUserId();
            if (cashierId is null)
            {
                return;
            }

            var json = JsonSerializer.Serialize(order with { OfflineLocalId = localId }, JsonOptions);
            if (Encoding.UTF8.GetByteCount(json) > MaxJsonBytes)
            {
                return;
            }

            var error = Truncate(failure.Message, ErrorMaxLength);
            var existing = await db.UnsyncedOrders.FirstOrDefaultAsync(u => u.OfflineLocalId == localId, cancellationToken);
            if (existing is null)
            {
                db.UnsyncedOrders.Add(new UnsyncedOrder
                {
                    OfflineLocalId = localId,
                    QuotedOrderJson = json,
                    ErrorText = error,
                    ErrorCode = CodeFor(failure),
                    CashierUserId = cashierId.Value,
                    DeviceCreatedAt = order.CreatedAt?.ToUniversalTime(),
                    ReceivedAt = DateTime.UtcNow,
                    QuotedTotal = order.ExpectedTotal ?? QuotedTotalOf(order),
                    StatusId = (byte)UnsyncedOrderStatusEnum.Open
                });
            }
            else if (existing.StatusId == (byte)UnsyncedOrderStatusEnum.Open)
            {
                existing.ErrorText = error;
                existing.ErrorCode = CodeFor(failure);
            }
            else
            {
                return;
            }

            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            db.ChangeTracker.Clear();
        }
    }

    public static async Task ResolveAfterSaveAsync(
        WTFDbContext db,
        IHttpContextAccessor httpContextAccessor,
        string localId,
        Guid orderId,
        CancellationToken cancellationToken)
    {
        try
        {
            var open = await db.UnsyncedOrders.FirstOrDefaultAsync(
                u => u.OfflineLocalId == localId && u.StatusId == (byte)UnsyncedOrderStatusEnum.Open,
                cancellationToken);
            if (open is null)
            {
                return;
            }

            open.StatusId = (byte)UnsyncedOrderStatusEnum.Resolved;
            open.Resolution = (byte)UnsyncedOrderResolutionEnum.Retried;
            open.ResolvedAt = DateTime.UtcNow;
            open.ResolvedBy = httpContextAccessor.HttpContext?.User.GetUserId();
            open.ResultingOrderId = orderId;
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            db.ChangeTracker.Clear();
        }
    }

    public static decimal QuotedTotalOf(CreateOrderCommand order)
    {
        return QuotedOrderTotal.OfLines(
            order.Items.Select(ToQuotedLine),
            order.BundlePromotions.Select(b => (b.Quantity, b.QuotedUnitPrice)));
    }

    public static string Truncate(string text, int max)
    {
        return text.Length <= max ? text : text[..max];
    }

    private static QuotedLine ToQuotedLine(DTOs.OrderItemRequestDto line)
    {
        return new QuotedLine(line.Quantity, line.QuotedPrice, [.. line.AddOns.Select(ToQuotedLine)]);
    }

    private static string CodeFor(Exception failure)
    {
        if (failure is ArgumentException)
        {
            return "InvalidData";
        }

        return failure.Message.Contains("not found", StringComparison.OrdinalIgnoreCase) ? "NotFound" : "Rejected";
    }
}
