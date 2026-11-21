using Microsoft.EntityFrameworkCore;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

// The order number the way people read it: with the branch code in front once the shop has more than one active branch.
internal static class OrderLabelLookup
{
    public static async Task<bool> IsMultiBranchAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        var active = await db.Branches.IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .AsNoTracking()
            .Where(b => b.IsActive)
            .Take(2)
            .CountAsync(cancellationToken);
        return active > 1;
    }

    public static async Task<string> LabelAsync(WTFDbContext db, Order order, CancellationToken cancellationToken)
    {
        if (!await IsMultiBranchAsync(db, cancellationToken))
        {
            return OrderLabels.Number(order.OrderNumber, null, false);
        }

        var code = order.Branch?.Code ?? await db.Branches.IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .AsNoTracking()
            .Where(b => b.Id == order.BranchId)
            .Select(b => b.Code)
            .FirstOrDefaultAsync(cancellationToken);
        return OrderLabels.Number(order.OrderNumber, code, true);
    }
}
