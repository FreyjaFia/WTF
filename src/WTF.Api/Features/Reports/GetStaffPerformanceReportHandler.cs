using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetStaffPerformanceReportQuery : IRequest<List<StaffPerformanceReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
    public Guid? StaffId { get; init; }
}

public sealed class GetStaffPerformanceReportHandler(WTFDbContext db) : IRequestHandler<GetStaffPerformanceReportQuery, List<StaffPerformanceReportRowDto>>
{
    public async Task<List<StaffPerformanceReportRowDto>> Handle(GetStaffPerformanceReportQuery request, CancellationToken cancellationToken)
    {
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate);

        var query = db.Orders
            .AsNoTracking()
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == (int)OrderStatusEnum.Completed);

        if (request.StaffId.HasValue)
        {
            query = query.Where(o => o.CreatedBy == request.StaffId.Value);
        }

        var grouped = await query
            .GroupBy(o => new
            {
                o.CreatedBy,
                o.CreatedByNavigation.FirstName,
                o.CreatedByNavigation.LastName
            })
            .Select(g => new
            {
                StaffId = g.Key.CreatedBy,
                StaffName = $"{g.Key.FirstName} {g.Key.LastName}".Trim(),
                OrderCount = g.Count(),
                TotalRevenue = g.Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity)),
                TipsReceived = g.Sum(o => o.Tips ?? 0m)
            })
            .OrderByDescending(r => r.TotalRevenue)
            .ToListAsync(cancellationToken);

        return grouped
            .Select(row => new StaffPerformanceReportRowDto(
                row.StaffId,
                row.StaffName,
                row.OrderCount,
                row.TotalRevenue,
                row.OrderCount > 0 ? row.TotalRevenue / row.OrderCount : 0m,
                row.TipsReceived))
            .ToList();
    }
}
