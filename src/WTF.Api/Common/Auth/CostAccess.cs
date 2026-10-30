using System.Security.Claims;
using WTF.Api.Features.Items.DTOs;

namespace WTF.Api.Common.Auth;

public static class CostAccess
{
    public static readonly string[] Roles = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer];

    public static bool CanReadCosts(ClaimsPrincipal user) => Roles.Any(user.IsInRole);

    public static ItemDto ForUser(ItemDto item, ClaimsPrincipal user) =>
        CanReadCosts(user) ? item : Redact(item);

    public static List<ItemDto> ForUser(List<ItemDto> items, ClaimsPrincipal user) =>
        CanReadCosts(user) ? items : [.. items.Select(Redact)];

    public static PagedStockMovementsDto ForUser(PagedStockMovementsDto page, ClaimsPrincipal user) =>
        CanReadCosts(user) ? page : page with { Items = [.. page.Items.Select(Redact)] };

    public static ItemDto Redact(ItemDto item) => item with
    {
        CostPrice = null,
        AverageCost = null,
        UsableCost = null,
        PriceHistory = [],
        RecentMovements = [.. item.RecentMovements.Select(Redact)]
    };

    public static StockMovementDto Redact(StockMovementDto movement) => movement with { UnitCost = null };
}
