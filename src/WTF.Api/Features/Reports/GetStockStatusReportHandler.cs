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
        var items = await db.Items
            .AsNoTracking()
            .Where(i => i.IsActive)
            .ToListAsync(cancellationToken);

        return items
            .Select(i => new
            {
                Item = i,
                Status = StockRules.StatusFor(i.CurrentQuantity, i.WarningQuantity, i.CriticalQuantity)
            })
            .OrderByDescending(x => x.Status)
            .ThenBy(x => x.Item.Name)
            .Select(x => new StockStatusReportRowDto(
                x.Item.Id,
                x.Item.Name,
                x.Item.UnitName,
                x.Item.CurrentQuantity,
                x.Item.WarningQuantity,
                x.Item.CriticalQuantity,
                StatusLabel(x.Status),
                CostRules.MovementCost(x.Item.AverageCost, x.Item.CostPrice),
                StockRules.StockValue(x.Item.CurrentQuantity, CostRules.MovementCost(x.Item.AverageCost, x.Item.CostPrice))))
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
