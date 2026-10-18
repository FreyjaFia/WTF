using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
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
    string? Error);

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

        var alreadySaved = await FindSavedAsync(localId, cancellationToken);
        if (alreadySaved is not null)
        {
            return alreadySaved;
        }

        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

            // Only a finished sale can meet a catalog that changed afterwards; an open order is priced when it completes.
            var reasons = order.Status == OrderStatusEnum.Completed
                ? await OfflineOrderReview.FindReasonsAsync(db, order, timeZone, cancellationToken)
                : [];

            var saved = await sender.Send(
                order with { OfflineLocalId = localId, HeldReasons = reasons.Count > 0 ? reasons : null },
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            return new OfflineSyncResultDto(localId, saved.Id, saved.OrderNumber, saved.Status, reasons, null);
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

        var reasons = string.IsNullOrEmpty(saved.ReviewReasons) ? [] : saved.ReviewReasons.Split('\n').ToList();
        return new OfflineSyncResultDto(localId, saved.Id, saved.OrderNumber, (OrderStatusEnum)saved.StatusId, reasons, null);
    }

    private static OfflineSyncResultDto Failed(string? localId, string message)
    {
        return new OfflineSyncResultDto(localId, null, null, null, [], message);
    }
}
