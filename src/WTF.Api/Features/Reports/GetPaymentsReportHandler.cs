using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Reports;

public sealed record GetPaymentsReportQuery : IRequest<List<PaymentsReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
}

public sealed class GetPaymentsReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetPaymentsReportQuery, List<PaymentsReportRowDto>>
{
    public async Task<List<PaymentsReportRowDto>> Handle(GetPaymentsReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate, timeZone);

        var orders = await db.Orders
            .AsNoTracking()
            .Include(o => o.PaymentMethod)
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
            .GroupBy(o => o.PaymentMethod != null ? o.PaymentMethod.Name : "Unknown")
            .Select(g => new
            {
                PaymentMethod = g.Key,
                OrderCount = g.Count(),
                TotalAmount = g.Sum(o => ComputeOrderRevenue(o, overridePrices))
            })
            .OrderByDescending(r => r.TotalAmount)
            .ToList();

        var grandTotal = grouped.Sum(g => g.TotalAmount);

        return grouped
            .Select(row => new PaymentsReportRowDto(
                row.PaymentMethod,
                row.OrderCount,
                row.TotalAmount,
                grandTotal > 0 ? row.TotalAmount / grandTotal * 100 : 0m))
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
