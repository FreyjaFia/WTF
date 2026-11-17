using WTF.Api.Features.Kitchen.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Kitchen;

internal static class KitchenOrderLookup
{
    public static async Task<KitchenOrderDto?> OneAsync(WTFDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var timeZone = await KitchenBoardLoader.ShopTimeZoneAsync(db, cancellationToken);
        var list = await KitchenBoardLoader.MapAsync(db, db.Orders.Where(o => o.Id == id), timeZone, DateTime.UtcNow, cancellationToken);
        return list.FirstOrDefault();
    }
}
