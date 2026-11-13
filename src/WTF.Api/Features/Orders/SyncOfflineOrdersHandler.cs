using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record SyncOfflineOrdersCommand(List<CreateOrderCommand> Orders) : IRequest<List<OfflineSyncResultDto>>;

public record OfflineSyncResultDto(
    string? OfflineLocalId,
    Guid? OrderId,
    int? OrderNumber,
    OrderStatusEnum? Status,
    List<string> Reasons,
    string? Error,
    List<string>? StockWarnings = null,
    List<OrderReviewReasonDto>? ReasonDetails = null);

public class SyncOfflineOrdersHandler(WTFDbContext db, ISender sender, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<SyncOfflineOrdersCommand, List<OfflineSyncResultDto>>
{
    private const int MaxLocalIdLength = 40;

    public async Task<List<OfflineSyncResultDto>> Handle(SyncOfflineOrdersCommand request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var results = new List<OfflineSyncResultDto>(request.Orders.Count);

        foreach (var order in request.Orders)
        {
            results.Add(await SyncOneAsync(order, timeZone, cancellationToken));
        }

        return results;
    }

    private async Task<OfflineSyncResultDto> SyncOneAsync(CreateOrderCommand order, TimeZoneInfo timeZone, CancellationToken cancellationToken)
    {
        var localId = order.OfflineLocalId?.Trim();
        if (string.IsNullOrEmpty(localId) || localId.Length > MaxLocalIdLength)
        {
            return Failed(localId, $"An offline order needs its queue number ({MaxLocalIdLength} characters at most).");
        }

        var tooLate = OfflineSyncWindow.Check(httpContextAccessor.HttpContext, order.CreatedAt, DateTime.UtcNow);
        if (tooLate is not null)
        {
            return Failed(localId, tooLate);
        }

        var alreadySaved = await FindSavedAsync(localId, cancellationToken);
        if (alreadySaved is not null)
        {
            return alreadySaved;
        }

        try
        {
            // Judging the order against the catalog and saving it must see the same promotion uses, so another order cannot
            // take the last one in between and leave the saved price different from the one the review accepted.
            using var gate = await PromotionLimitGate.EnterAsync(db.StampTenantId, cancellationToken);
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

            // Only a finished sale can meet a catalog that changed afterwards; an open order is priced when it completes.
            var findings = order.Status == OrderStatusEnum.Completed
                ? await OfflineOrderReview.FindAsync(db, order, timeZone, cancellationToken)
                : [];

            var saved = await sender.Send(
                order with { OfflineLocalId = localId, ReviewFindings = findings.Count > 0 ? findings : null, GateHeld = true, HonorStock = true, HonorQuotedPrices = CanHonorQuotes(order), HonorSeniorPwdQuotes = CanHonorSeniorPwd(order), SeniorPwdVatRegistered = order.SeniorPwdPersons.Count > 0 ? await OfflineOrderReview.SeniorPwdVatAtSaleAsync(db, order, cancellationToken) : null },
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            return new OfflineSyncResultDto(
                localId,
                saved.Id,
                saved.OrderNumber,
                saved.Status,
                [.. findings.Select(f => f.Text).Distinct()],
                null,
                saved.StockWarnings,
                saved.ReviewDetails ?? [.. findings.Select(OrderReviewReasons.ToDto)]);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            db.ChangeTracker.Clear();
            return Failed(localId, ex.Message);
        }
        catch (DbUpdateException)
        {
            // Another request saved the same queue number in the meantime: that order is the answer.
            db.ChangeTracker.Clear();
            return await FindSavedAsync(localId, cancellationToken) ?? throw new InvalidOperationException("The order could not be saved.");
        }
    }

    private static bool CanHonorSeniorPwd(CreateOrderCommand order)
    {
        return order.Status == OrderStatusEnum.Completed && order.SeniorPwdPersons.Count > 0 && CanHonorQuotes(order);
    }

    private static bool CanHonorQuotes(CreateOrderCommand order)
    {
        return order.Status == OrderStatusEnum.Completed
            && order.Items.All(i => i.QuotedPrice.HasValue && i.AddOns.All(a => a.QuotedPrice.HasValue))
            && order.BundlePromotions.All(b => b.QuotedUnitPrice.HasValue);
    }

    private async Task<OfflineSyncResultDto?> FindSavedAsync(string localId, CancellationToken cancellationToken)
    {
        var saved = await db.Orders
            .AsNoTracking()
            .Where(o => o.OfflineLocalId == localId)
            .Select(o => new { o.Id, o.OrderNumber, o.StatusId, o.ReviewReasons })
            .FirstOrDefaultAsync(cancellationToken);

        if (saved is null)
        {
            return null;
        }

        var details = await OrderReviewReasons.LoadAsync(db, saved.Id, cancellationToken);
        var reasons = details.Count > 0
            ? details.Select(d => d.Text).Distinct().ToList()
            : string.IsNullOrEmpty(saved.ReviewReasons) ? [] : saved.ReviewReasons.Split('\n').ToList();
        return new OfflineSyncResultDto(localId, saved.Id, saved.OrderNumber, (OrderStatusEnum)saved.StatusId, reasons, null, null, details);
    }

    private static OfflineSyncResultDto Failed(string? localId, string message)
    {
        return new OfflineSyncResultDto(localId, null, null, null, [], message);
    }
}
