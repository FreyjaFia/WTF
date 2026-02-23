using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Dashboard.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Dashboard;

public record GetDashboardQuery(string? Preset, DateTime? StartDate, DateTime? EndDate) : IRequest<DashboardDto>;

public class GetDashboardHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetDashboardQuery, DashboardDto>
{
    private record DateRangeInfo(
        DateTime PrimaryStart,
        DateTime PrimaryEnd,
        DateTime ComparisonStart,
        DateTime ComparisonEnd,
        string ComparisonLabel,
        bool IsMultiDay);

    public async Task<DashboardDto> Handle(GetDashboardQuery request, CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var range = ComputeDateRange(request, nowUtc);

        var primaryOrders = await QueryOrders(range.PrimaryStart, range.PrimaryEnd, cancellationToken);
        var comparisonOrders = await QueryOrders(range.ComparisonStart, range.ComparisonEnd, cancellationToken);

        var summary = ComputeSummary(primaryOrders, comparisonOrders);
        var topProducts = await ComputeTopProducts(primaryOrders, cancellationToken);
        var ordersByStatus = ComputeOrdersByStatus(primaryOrders);

        var hourlyRevenue = range.IsMultiDay
            ? []
            : ComputeHourlyRevenue(primaryOrders, range, nowUtc);

        var dailyRevenue = range.IsMultiDay
            ? ComputeDailyRevenue(primaryOrders, range)
            : null;

        var recentOrders = await ComputeRecentOrders(range, cancellationToken);
        var paymentMethods = ComputePaymentMethods(primaryOrders);

        return new DashboardDto(
            summary,
            topProducts,
            ordersByStatus,
            recentOrders,
            hourlyRevenue,
            paymentMethods,
            range.ComparisonLabel,
            dailyRevenue);
    }

    private static DateRangeInfo ComputeDateRange(GetDashboardQuery request, DateTime nowUtc)
    {
        var todayUtc = nowUtc.Date;
        var preset = (request.Preset ?? "today").ToLowerInvariant();

        return preset switch
        {
            "yesterday" => new DateRangeInfo(
                todayUtc.AddDays(-1),
                todayUtc,
                todayUtc.AddDays(-2),
                todayUtc.AddDays(-1),
                "vs Day Before",
                false),

            "last7days" => new DateRangeInfo(
                todayUtc.AddDays(-6),
                todayUtc.AddDays(1),
                todayUtc.AddDays(-13),
                todayUtc.AddDays(-6),
                "vs Prev. 7 Days",
                true),

            "last30days" => new DateRangeInfo(
                todayUtc.AddDays(-29),
                todayUtc.AddDays(1),
                todayUtc.AddDays(-59),
                todayUtc.AddDays(-29),
                "vs Prev. 30 Days",
                true),

            "custom" when request.StartDate.HasValue && request.EndDate.HasValue =>
                ComputeCustomRange(request.StartDate.Value.Date, request.EndDate.Value.Date),

            // Default: "today"
            _ => new DateRangeInfo(
                todayUtc,
                todayUtc.AddDays(1),
                todayUtc.AddDays(-1),
                nowUtc.AddDays(-1),
                "vs Yesterday",
                false),
        };
    }

    private static DateRangeInfo ComputeCustomRange(DateTime startDate, DateTime endDate)
    {
        var primaryStart = startDate;
        var primaryEnd = endDate.AddDays(1);
        var rangeDays = (primaryEnd - primaryStart).Days;
        var isMultiDay = rangeDays > 1;

        var comparisonStart = primaryStart.AddDays(-rangeDays);
        var comparisonEnd = primaryStart;

        return new DateRangeInfo(
            primaryStart,
            primaryEnd,
            comparisonStart,
            comparisonEnd,
            "vs Prev. Period",
            isMultiDay);
    }

    private async Task<List<Order>> QueryOrders(DateTime start, DateTime end, CancellationToken cancellationToken)
    {
        return await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.PaymentMethod)
            .Where(o => o.CreatedAt >= start && o.CreatedAt < end)
            .ToListAsync(cancellationToken);
    }

    private static DailySummaryDto ComputeSummary(List<Order> primaryOrders, List<Order> comparisonOrders)
    {
        var totalOrders = primaryOrders.Count;
        var totalRevenue = primaryOrders
            .Where(o => o.StatusId == 2)
            .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
        var averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        var totalTips = primaryOrders.Sum(o => o.Tips ?? 0);
        var totalCustomers = primaryOrders
            .Where(o => o.CustomerId.HasValue)
            .Select(o => o.CustomerId)
            .Distinct()
            .Count();

        var compTotalOrders = comparisonOrders.Count;
        var compTotalRevenue = comparisonOrders
            .Where(o => o.StatusId == 2)
            .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
        var compAvgOrderValue = compTotalOrders > 0 ? compTotalRevenue / compTotalOrders : 0;
        var compTotalTips = comparisonOrders.Sum(o => o.Tips ?? 0);

        return new DailySummaryDto(
            totalOrders,
            totalRevenue,
            averageOrderValue,
            totalTips,
            totalCustomers,
            compTotalOrders,
            compTotalRevenue,
            compAvgOrderValue,
            compTotalTips);
    }

    private async Task<List<TopSellingProductDto>> ComputeTopProducts(
        List<Order> orders, CancellationToken cancellationToken)
    {
        var topProductGroups = orders
            .Where(o => o.StatusId == 2)
            .SelectMany(o => o.OrderItems)
            .Where(oi => oi.ParentOrderItemId == null)
            .GroupBy(oi => oi.ProductId)
            .Select(g => new
            {
                ProductId = g.Key,
                ProductName = g.First().Product.Name,
                QuantitySold = g.Sum(oi => oi.Quantity),
                Revenue = g.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity)
            })
            .OrderByDescending(p => p.QuantitySold)
            .Take(5)
            .ToList();

        var topProductIds = topProductGroups.Select(p => p.ProductId).ToList();

        var productImages = await db.ProductImages
            .Where(pi => topProductIds.Contains(pi.ProductId))
            .Include(pi => pi.Image)
            .ToDictionaryAsync(pi => pi.ProductId, pi => pi.Image.ImageUrl, cancellationToken);

        return topProductGroups.Select(g =>
        {
            productImages.TryGetValue(g.ProductId, out var relativeUrl);
            var absoluteUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, relativeUrl);
            return new TopSellingProductDto(g.ProductId, g.ProductName, g.QuantitySold, g.Revenue, absoluteUrl);
        }).ToList();
    }

    private static OrdersByStatusDto ComputeOrdersByStatus(List<Order> orders)
    {
        return new OrdersByStatusDto(
            orders.Count(o => o.StatusId == 1),
            orders.Count(o => o.StatusId == 2),
            orders.Count(o => o.StatusId == 3),
            orders.Count(o => o.StatusId == 4));
    }

    private static List<HourlyRevenuePointDto> ComputeHourlyRevenue(
        List<Order> orders, DateRangeInfo range, DateTime nowUtc)
    {
        // For partial days (e.g. "Today"), only up to current hour; for complete days, all 24 hours
        var isPartialDay = range.PrimaryEnd > nowUtc;
        var maxHour = isPartialDay ? nowUtc.Hour : 23;

        return Enumerable.Range(0, maxHour + 1)
            .Select(hour =>
            {
                var hourOrders = orders.Where(o => o.CreatedAt.Hour == hour).ToList();
                var revenue = hourOrders
                    .Where(o => o.StatusId == 2)
                    .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
                var orderCount = hourOrders.Count;
                var tips = hourOrders.Sum(o => o.Tips ?? 0);
                return new HourlyRevenuePointDto(hour, revenue, orderCount, tips);
            })
            .ToList();
    }

    private static List<DailyRevenuePointDto> ComputeDailyRevenue(List<Order> orders, DateRangeInfo range)
    {
        var days = (int)(range.PrimaryEnd - range.PrimaryStart).TotalDays;

        return Enumerable.Range(0, days)
            .Select(offset =>
            {
                var date = range.PrimaryStart.AddDays(offset);
                var dayOrders = orders.Where(o => o.CreatedAt.Date == date).ToList();
                var revenue = dayOrders
                    .Where(o => o.StatusId == 2)
                    .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
                var orderCount = dayOrders.Count;
                var tips = dayOrders.Sum(o => o.Tips ?? 0);
                return new DailyRevenuePointDto(date, revenue, orderCount, tips);
            })
            .ToList();
    }

    private async Task<List<RecentOrderDto>> ComputeRecentOrders(
        DateRangeInfo range, CancellationToken cancellationToken)
    {
        var recentOrderEntities = await db.Orders
            .Include(o => o.Status)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o => o.CreatedAt >= range.PrimaryStart && o.CreatedAt < range.PrimaryEnd)
            .OrderByDescending(o => o.CreatedAt)
            .Take(5)
            .ToListAsync(cancellationToken);

        var recentParentProductIds = recentOrderEntities
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var recentAddOnProductIds = recentOrderEntities
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId != null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var recentOverridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

        if (recentAddOnProductIds.Count > 0)
        {
            recentOverridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => recentParentProductIds.Contains(o.ProductId)
                    && recentAddOnProductIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        return recentOrderEntities.Select(o =>
        {
            var parentItems = o.OrderItems.Where(oi => oi.ParentOrderItemId == null).ToList();
            var total = parentItems.Sum(oi =>
            {
                var itemPrice = (oi.Price ?? oi.Product.Price) * oi.Quantity;
                var addOnsPrice = o.OrderItems
                    .Where(child => child.ParentOrderItemId == oi.Id)
                    .Sum(child =>
                    {
                        var effectivePrice = child.Price
                            ?? (recentOverridePrices.TryGetValue((oi.ProductId, child.ProductId), out var op)
                                ? op
                                : child.Product.Price);
                        return effectivePrice * child.Quantity;
                    });
                return itemPrice + addOnsPrice;
            });

            return new RecentOrderDto(o.Id, o.OrderNumber, o.CreatedAt, total, o.StatusId, o.Status.Name);
        }).ToList();
    }

    private static List<PaymentMethodBreakdownDto> ComputePaymentMethods(List<Order> orders)
    {
        return orders
            .Where(o => o.StatusId == 2 && o.PaymentMethodId.HasValue)
            .GroupBy(o => o.PaymentMethod!.Name)
            .Select(g => new PaymentMethodBreakdownDto(
                g.Key,
                g.Count(),
                g.Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity))))
            .OrderByDescending(p => p.Total)
            .ToList();
    }
}
