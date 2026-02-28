using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetHourlySalesReportQuery : IRequest<List<HourlySalesReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
}

public sealed class GetHourlySalesReportHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetHourlySalesReportQuery, List<HourlySalesReportRowDto>>
{
    public async Task<List<HourlySalesReportRowDto>> Handle(GetHourlySalesReportQuery request, CancellationToken cancellationToken)
    {
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate);
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == (int)OrderStatusEnum.Completed)
            .ToListAsync(cancellationToken);

        var grouped = orders
            .GroupBy(o => TimeZoneInfo.ConvertTimeFromUtc(
                ReportDateRange.EnsureUtcDate(o.CreatedAt),
                timeZone).Hour)
            .Select(g => new
            {
                Hour = g.Key,
                OrderCount = g.Count(),
                Revenue = g.Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity))
            })
            .ToList();

        var byHour = grouped.ToDictionary(g => g.Hour, g => g);

        return Enumerable.Range(0, 24)
            .Select(hour =>
            {
                byHour.TryGetValue(hour, out var row);
                return new HourlySalesReportRowDto(
                    hour,
                    row?.OrderCount ?? 0,
                    row?.Revenue ?? 0m);
            })
            .ToList();
    }
}
