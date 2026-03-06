using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

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
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate, timeZone);

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == (int)OrderStatusEnum.Completed)
            .ToListAsync(cancellationToken);

        var overridePrices = await BuildAddOnOverridePriceLookup(orders, cancellationToken);

        var grouped = orders
            .GroupBy(o => TimeZoneInfo.ConvertTimeFromUtc(
                ReportDateRange.EnsureUtcDate(o.CreatedAt),
                timeZone).Hour)
            .Select(g => new
            {
                Hour = g.Key,
                OrderCount = g.Count(),
                Revenue = g.Sum(o => ComputeOrderRevenue(o, overridePrices))
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

    private static decimal ComputeOrderRevenue(
        Order order,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices) =>
        OrderMetrics.ComputeOrderTotal(order, addOnOverridePrices);

    private async Task<Dictionary<(Guid ProductId, Guid AddOnId), decimal>> BuildAddOnOverridePriceLookup(
        IReadOnlyCollection<Order> orders,
        CancellationToken cancellationToken)
    {
        var parentProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var addOnProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId != null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        if (addOnProductIds.Count == 0)
        {
            return [];
        }

        return await db.ProductAddOnPriceOverrides
            .Where(o => parentProductIds.Contains(o.ProductId)
                && addOnProductIds.Contains(o.AddOnId)
                && o.IsActive)
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
    }
}
