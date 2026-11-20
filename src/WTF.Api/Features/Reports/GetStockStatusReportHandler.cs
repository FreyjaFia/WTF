using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetStockStatusReportQuery : IRequest<List<StockStatusReportRowDto>>;

public sealed class GetStockStatusReportHandler(WTFDbContext db) : IRequestHandler<GetStockStatusReportQuery, List<StockStatusReportRowDto>>
{
    public async Task<List<StockStatusReportRowDto>> Handle(GetStockStatusReportQuery request, CancellationToken cancellationToken)
    {
        // One row per item and branch the person may see, so "All branches" shows each branch's stock and its own status.
        var rows = await db.ItemBranchStocks
            .AsNoTracking()
            .Where(s => s.Item.IsActive)
            .Select(s => new { s.Item, s.CurrentQuantity, BranchName = s.Branch.Name, s.Branch.IsMain })
            .ToListAsync(cancellationToken);

        return rows
            .Select(r => new
            {
                r.Item,
                r.CurrentQuantity,
                r.BranchName,
                r.IsMain,
                Status = StockRules.StatusFor(r.CurrentQuantity, r.Item.WarningQuantity, r.Item.CriticalQuantity)
            })
            .OrderByDescending(x => x.Status)
            .ThenBy(x => x.Item.Name)
            .ThenByDescending(x => x.IsMain)
            .ThenBy(x => x.BranchName)
            .Select(x => new StockStatusReportRowDto(
                x.Item.Id,
                x.Item.Name,
                x.Item.UnitName,
                x.CurrentQuantity,
                x.Item.WarningQuantity,
                x.Item.CriticalQuantity,
                StatusLabel(x.Status),
                CostRules.MovementCost(x.Item.AverageCost, x.Item.CostPrice),
                StockRules.StockValue(x.CurrentQuantity, CostRules.MovementCost(x.Item.AverageCost, x.Item.CostPrice)),
                x.BranchName))
            .ToList();
    }

    public static string StatusLabel(StockStatus status) => status switch
    {
        StockStatus.OutOfStock => "Out of stock",
        StockStatus.Critical => "Critical",
        StockStatus.Warning => "Warning",
        _ => "OK"
    };
}
