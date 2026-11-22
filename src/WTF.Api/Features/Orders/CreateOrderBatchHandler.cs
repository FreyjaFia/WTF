using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Orders.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record CreateOrderBatchCommand(List<CreateOrderCommand> Orders) : IRequest<List<OrderDto>>;

public class CreateOrderBatchHandler(WTFDbContext db, ISender sender, IHttpContextAccessor? httpContextAccessor = null)
    : IRequestHandler<CreateOrderBatchCommand, List<OrderDto>>
{
    public async Task<List<OrderDto>> Handle(CreateOrderBatchCommand request, CancellationToken cancellationToken)
    {
        if (request.Orders.Count == 0)
        {
            return [];
        }

        foreach (var order in request.Orders)
        {
            var now = DateTime.UtcNow;
            var tooLate = OfflineSyncWindow.CheckClaimedTime(order.CreatedAt, now, null)
                ?? OfflineSyncWindow.Check(httpContextAccessor?.HttpContext, order.CreatedAt, now);
            if (tooLate is not null)
            {
                throw new InvalidOperationException(tooLate);
            }

            var badCatalogTime = OfflineSyncWindow.CheckCatalogTime(order.CatalogSyncedAt, order.CreatedAt, now);
            if (badCatalogTime is not null)
            {
                throw new InvalidOperationException(badCatalogTime);
            }
        }

        using var gate = await PromotionLimitGate.EnterAsync(db.StampTenantId, cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var results = new List<OrderDto>(request.Orders.Count);

        foreach (var order in request.Orders)
        {
            // A retry after a lost response carries the same key: answer with the order that was already saved.
            var key = order.OfflineLocalId?.Trim();
            if (!string.IsNullOrEmpty(key))
            {
                var savedId = await db.Orders.AsNoTracking()
                    .Where(o => o.OfflineLocalId == key)
                    .Select(o => (Guid?)o.Id)
                    .FirstOrDefaultAsync(cancellationToken);
                var saved = savedId is null ? null : await sender.Send(new GetOrderByIdQuery(savedId.Value), cancellationToken);
                if (saved is not null)
                {
                    results.Add(saved);
                    continue;
                }
            }

            // The batch route never lets a device name the branch: the order goes to the branch the person is working in.
            var result = await sender.Send(order with { BranchId = null, OfflineLocalId = string.IsNullOrEmpty(key) ? order.OfflineLocalId : key, GateHeld = true, HonorStock = true }, cancellationToken);
            results.Add(result);
        }

        await transaction.CommitAsync(cancellationToken);

        return results;
    }
}
