using WTF.Api.Common.Tenancy;
using WTF.Calculations.Kitchen;
using WTF.Calculations.Sales;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Kitchen;

public static class KitchenTracking
{
    // The shop's switch is part of the plan lookup, so a shop with the board off (or a plan without it) is not tracked. A
    // request with no shop (unit tests, jobs) never starts tracking.
    public static async Task<bool> IsOnAsync(WTFDbContext db, ITenantFeatures features, CancellationToken cancellationToken) =>
        db.StampTenantId is { } tenantId
        && (await features.GetAsync(db, tenantId, cancellationToken)).Features.Contains(PlanFeatures.Kitchen);

    public static bool CanStart(int statusId) => statusId is OrderStatuses.Pending or OrderStatuses.Completed;

    public static void Start(Order order)
    {
        order.KitchenStatus = (byte)KitchenState.New;
    }

    public static void StartIfTracked(Order order, bool tracking)
    {
        if (tracking && order.KitchenStatus is null && CanStart(order.StatusId))
        {
            Start(order);
        }
    }
}
