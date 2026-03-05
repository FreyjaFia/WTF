using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Dashboard.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Dashboard;

public record GetDashboardQuery(string? Preset, DateTime? StartDate, DateTime? EndDate) : IRequest<DashboardDto>;

public class GetDashboardHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetDashboardQuery, DashboardDto>
{
    private record DateRangeInfo(
        DateTime PrimaryStartUtc,
        DateTime PrimaryEndUtc,
        DateTime ComparisonStartUtc,
        DateTime ComparisonEndUtc,
        DateTime PrimaryStartLocal,
        DateTime PrimaryEndLocal,
        string ComparisonLabel,
        bool IsMultiDay);

    public async Task<DashboardDto> Handle(GetDashboardQuery request, CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var range = ComputeDateRange(request, nowUtc, timeZone);
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, timeZone);

        var primaryOrders = await QueryOrders(range.PrimaryStartUtc, range.PrimaryEndUtc, cancellationToken);
        var comparisonOrders = await QueryOrders(range.ComparisonStartUtc, range.ComparisonEndUtc, cancellationToken);

        var summary = ComputeSummary(primaryOrders, comparisonOrders);
        var topProducts = await ComputeTopProducts(primaryOrders, cancellationToken);
        var ordersByStatus = ComputeOrdersByStatus(primaryOrders);

        var hourlyRevenue = range.IsMultiDay
            ? []
            : ComputeHourlyRevenue(primaryOrders, range, nowLocal, timeZone);

        var dailyRevenue = range.IsMultiDay
            ? ComputeDailyRevenue(primaryOrders, range, timeZone)
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

    private static DateRangeInfo ComputeDateRange(GetDashboardQuery request, DateTime nowUtc, TimeZoneInfo timeZone)
    {
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, timeZone);
        var localToday = localNow.Date;
        var preset = (request.Preset ?? "today").ToLowerInvariant();

        return preset switch
        {
            "yesterday" => new DateRangeInfo(
                ToUtc(localToday.AddDays(-1), timeZone),
                ToUtc(localToday, timeZone),
                ToUtc(localToday.AddDays(-2), timeZone),
                ToUtc(localToday.AddDays(-1), timeZone),
                localToday.AddDays(-1),
                localToday,
                "vs Day Before",
                false),

            "last7days" => new DateRangeInfo(
                ToUtc(localToday.AddDays(-6), timeZone),
                ToUtc(localToday.AddDays(1), timeZone),
                ToUtc(localToday.AddDays(-13), timeZone),
                ToUtc(localToday.AddDays(-6), timeZone),
                localToday.AddDays(-6),
                localToday.AddDays(1),
                "vs Prev. 7 Days",
                true),

            "last30days" => new DateRangeInfo(
                ToUtc(localToday.AddDays(-29), timeZone),
                ToUtc(localToday.AddDays(1), timeZone),
                ToUtc(localToday.AddDays(-59), timeZone),
                ToUtc(localToday.AddDays(-29), timeZone),
                localToday.AddDays(-29),
                localToday.AddDays(1),
                "vs Prev. 30 Days",
                true),

            "custom" when request.StartDate.HasValue && request.EndDate.HasValue =>
                ComputeCustomRange(request.StartDate.Value.Date, request.EndDate.Value.Date, timeZone),

            // Default: "today"
            _ => new DateRangeInfo(
                ToUtc(localToday, timeZone),
                ToUtc(localToday.AddDays(1), timeZone),
                ToUtc(localToday.AddDays(-1), timeZone),
                ToUtc(localToday, timeZone),
                localToday,
                localToday.AddDays(1),
                "vs Yesterday",
                false),
        };
    }

    private static DateRangeInfo ComputeCustomRange(DateTime startDate, DateTime endDate, TimeZoneInfo timeZone)
    {
        var primaryStart = startDate;
        var primaryEnd = endDate.AddDays(1);
        var rangeDays = (primaryEnd - primaryStart).Days;
        var isMultiDay = rangeDays > 1;

        var comparisonStart = primaryStart.AddDays(-rangeDays);
        var comparisonEnd = primaryStart;

        return new DateRangeInfo(
            ToUtc(primaryStart, timeZone),
            ToUtc(primaryEnd, timeZone),
            ToUtc(comparisonStart, timeZone),
            ToUtc(comparisonEnd, timeZone),
            primaryStart,
            primaryEnd,
            "vs Prev. Period",
            isMultiDay);
    }

    private async Task<List<Order>> QueryOrders(DateTime start, DateTime end, CancellationToken cancellationToken)
    {
        return await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .Include(o => o.PaymentMethod)
            .Where(o => o.CreatedAt >= start && o.CreatedAt < end)
            .ToListAsync(cancellationToken);
    }

    private static DailySummaryDto ComputeSummary(List<Order> primaryOrders, List<Order> comparisonOrders)
    {
        var totalOrders = primaryOrders.Count;
        var totalRevenue = primaryOrders
            .Where(o => o.StatusId == 2)
            .Sum(ComputeOrderTotal);
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
            .Sum(ComputeOrderTotal);
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
        var productRows = orders
            .Where(o => o.StatusId == 2)
            .SelectMany(o => o.OrderItems)
            .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
            .GroupBy(oi => oi.ProductId)
            .Select(g => new
            {
                EntityId = g.Key,
                Name = g.First().Product.Name,
                QuantitySold = g.Sum(oi => oi.Quantity),
                Revenue = g.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity),
                IsBundle = false
            })
            .ToList();

        var bundleGroupCandidates = orders
            .Where(o => o.StatusId == 2)
            .SelectMany(o => o.OrderBundlePromotions)
            .GroupBy(obp => obp.PromotionId)
            .Select(g => new
            {
                PromotionId = g.Key,
                QuantitySold = g.Sum(obp => obp.Quantity),
                Revenue = g.Sum(obp => obp.UnitPrice * obp.Quantity)
            })
            .ToList();

        var bundlePromotionIds = bundleGroupCandidates.Select(x => x.PromotionId).Distinct().ToList();
        var bundlePromotionMap = bundlePromotionIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Promotions
                .Where(p => bundlePromotionIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

        var bundleRows = bundleGroupCandidates
            .Where(x => bundlePromotionMap.ContainsKey(x.PromotionId))
            .Select(x => new
            {
                EntityId = x.PromotionId,
                Name = bundlePromotionMap[x.PromotionId],
                x.QuantitySold,
                x.Revenue,
                IsBundle = true
            })
            .ToList();

        var topRows = productRows
            .Concat(bundleRows)
            .OrderByDescending(p => p.QuantitySold)
            .Take(5)
            .ToList();

        var topProductIds = topRows.Where(x => !x.IsBundle).Select(x => x.EntityId).ToList();
        var topBundleIds = topRows.Where(x => x.IsBundle).Select(x => x.EntityId).ToList();

        var productImages = topProductIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.ProductImages
                .Where(pi => topProductIds.Contains(pi.ProductId))
                .Include(pi => pi.Image)
                .ToDictionaryAsync(pi => pi.ProductId, pi => pi.Image.ImageUrl, cancellationToken);

        var bundleImages = topBundleIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.PromotionImages
                .Where(pi => topBundleIds.Contains(pi.PromotionId))
                .Include(pi => pi.Image)
                .ToDictionaryAsync(pi => pi.PromotionId, pi => pi.Image.ImageUrl, cancellationToken);

        return topRows.Select(g =>
        {
            var relativeUrl = g.IsBundle
                ? bundleImages.GetValueOrDefault(g.EntityId)
                : productImages.GetValueOrDefault(g.EntityId);
            var absoluteUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, relativeUrl);
            return new TopSellingProductDto(g.EntityId, g.Name, g.QuantitySold, g.Revenue, absoluteUrl);
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
        List<Order> orders, DateRangeInfo range, DateTime nowLocal, TimeZoneInfo timeZone)
    {
        // For partial days (e.g. "Today"), only up to current hour; for complete days, all 24 hours
        var isPartialDay = nowLocal >= range.PrimaryStartLocal && nowLocal < range.PrimaryEndLocal;
        var maxHour = isPartialDay ? nowLocal.Hour : 23;

        return Enumerable.Range(0, maxHour + 1)
            .Select(hour =>
            {
                var hourOrders = orders
                    .Where(o => TimeZoneInfo.ConvertTimeFromUtc(o.CreatedAt, timeZone).Hour == hour)
                    .ToList();
                var revenue = hourOrders
                    .Where(o => o.StatusId == 2)
                    .Sum(ComputeOrderTotal);
                var orderCount = hourOrders.Count;
                var tips = hourOrders.Sum(o => o.Tips ?? 0);
                return new HourlyRevenuePointDto(hour, revenue, orderCount, tips);
            })
            .ToList();
    }

    private static List<DailyRevenuePointDto> ComputeDailyRevenue(List<Order> orders, DateRangeInfo range, TimeZoneInfo timeZone)
    {
        var days = (int)(range.PrimaryEndLocal - range.PrimaryStartLocal).TotalDays;

        return Enumerable.Range(0, days)
            .Select(offset =>
            {
                var date = range.PrimaryStartLocal.AddDays(offset);
                var dayOrders = orders
                    .Where(o => TimeZoneInfo.ConvertTimeFromUtc(o.CreatedAt, timeZone).Date == date)
                    .ToList();
                var revenue = dayOrders
                    .Where(o => o.StatusId == 2)
                    .Sum(ComputeOrderTotal);
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
            .Include(o => o.OrderBundlePromotions)
            .Where(o => o.CreatedAt >= range.PrimaryStartUtc && o.CreatedAt < range.PrimaryEndUtc)
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
            var parentItems = o.OrderItems
                .Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null)
                .ToList();
            var total = parentItems.Sum(oi =>
            {
                var itemUnitPrice = oi.Price ?? oi.Product.Price;
                var addOnsPerUnit = o.OrderItems
                    .Where(child => child.ParentOrderItemId == oi.Id && child.BundlePromotionId == null)
                    .Sum(child =>
                    {
                        var effectivePrice = child.Price
                            ?? (recentOverridePrices.TryGetValue((oi.ProductId, child.ProductId), out var op)
                                ? op
                                : child.Product.Price);
                        return effectivePrice * child.Quantity;
                    });
                return (itemUnitPrice + addOnsPerUnit) * oi.Quantity;
            });
            total += o.OrderBundlePromotions.Sum(bundle => bundle.UnitPrice * bundle.Quantity);

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
                g.Sum(ComputeOrderTotal)))
            .OrderByDescending(p => p.Total)
            .ToList();
    }

    private static decimal ComputeOrderTotal(Order order) => OrderMetrics.ComputeOrderTotal(order);

    private static DateTime ToUtc(DateTime localDateTime, TimeZoneInfo timeZone)
    {
        return TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localDateTime, DateTimeKind.Unspecified),
            timeZone);
    }

}
