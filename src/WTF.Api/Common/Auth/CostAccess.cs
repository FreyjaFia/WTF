using System.Security.Claims;
using WTF.Api.Features.Inventory.Receiving;
using WTF.Api.Features.Inventory.Reordering;
using WTF.Api.Features.Inventory.Suppliers;
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

    public static List<ItemSupplierDto> ForUser(List<ItemSupplierDto> links, ClaimsPrincipal user) =>
        CanReadCosts(user) ? links : [.. links.Select(Redact)];

    public static SupplierDto ForUser(SupplierDto supplier, ClaimsPrincipal user) =>
        CanReadCosts(user) ? supplier : supplier with { Items = [.. supplier.Items.Select(i => i with { PackPrice = null, UnitCost = null })] };

    public static StockReceiptDto ForUser(StockReceiptDto receipt, ClaimsPrincipal user) =>
        CanReadCosts(user) ? receipt : new StockReceiptDto(Redact(receipt.Summary), [.. receipt.Lines.Select(l => l with { PackPrice = null, UnitCost = null, LineTotal = null })]);

    public static List<StockReceiptSummaryDto> ForUser(List<StockReceiptSummaryDto> receipts, ClaimsPrincipal user) =>
        CanReadCosts(user) ? receipts : [.. receipts.Select(Redact)];

    public static StockReceiptSummaryDto Redact(StockReceiptSummaryDto receipt) =>
        receipt with { InvoiceTotal = null, LinesTotal = null, Difference = null };

    public static ReorderListDto ForUser(ReorderListDto list, ClaimsPrincipal user) =>
        CanReadCosts(user) ? list : list with
        {
            Groups = [.. list.Groups.Select(g => g with
            {
                EstimatedCost = null,
                Lines = [.. g.Lines.Select(l => l with { PackPrice = null, EstimatedCost = null })]
            })]
        };

    public static ItemSupplierDto Redact(ItemSupplierDto link) => link with
    {
        PackPrice = null,
        UnitCost = null,
        IsCheapest = false,
        LastChangePercent = null,
        PriceHistory = []
    };

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
