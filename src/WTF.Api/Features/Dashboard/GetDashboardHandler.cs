using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Dashboard.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
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
        var overridePrices = await AddOnPriceLookup.ForOrdersAsync(
            db,
            primaryOrders.Concat(comparisonOrders),
            cancellationToken);

        var summary = ComputeSummary(primaryOrders, comparisonOrders, overridePrices);
        var topProducts = await ComputeTopProducts(primaryOrders, overridePrices, cancellationToken);
        var ordersByStatus = ComputeOrdersByStatus(primaryOrders);

        var hourlyRevenue = range.IsMultiDay
            ? []
            : ComputeHourlyRevenue(primaryOrders, range, nowLocal, timeZone, overridePrices);

        var dailyRevenue = range.IsMultiDay
            ? ComputeDailyRevenue(primaryOrders, range, timeZone, overridePrices)
            : null;

        var recentOrders = await ComputeRecentOrders(range, cancellationToken);
        var paymentMethods = ComputePaymentMethods(primaryOrders, overridePrices);

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

    private static DailySummaryDto ComputeSummary(
        List<Order> primaryOrders,
        List<Order> comparisonOrders,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        var primary = SalesRules.Summarize(primaryOrders, addOnOverridePrices);
        var comparison = SalesRules.Summarize(comparisonOrders, addOnOverridePrices);
        var totalCustomers = primaryOrders
            .Where(o => o.CustomerId.HasValue)
            .Select(o => o.CustomerId)
            .Distinct()
            .Count();

        return new DailySummaryDto(
            primary.TotalOrderCount,
            primary.Revenue,
            primary.AverageOrderValue,
            primary.Tips,
            totalCustomers,
            comparison.TotalOrderCount,
            comparison.Revenue,
            comparison.AverageOrderValue,
            comparison.Tips);
    }

    private async Task<List<TopSellingProductDto>> ComputeTopProducts(
        List<Order> orders,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices,
        CancellationToken cancellationToken)
    {
        var productRows = orders
            .Where(o => SalesRules.IsSale(o.StatusId))
            .SelectMany(
                o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null && oi.BundlePromotionId == null),
                (o, oi) => new { Order = o, ParentItem = oi })
            .GroupBy(x => x.ParentItem.ProductId)
            .Select(g => new
            {
                EntityId = g.Key,
                Name = g.First().ParentItem.Product.Name,
                QuantitySold = g.Sum(x => x.ParentItem.Quantity),
                Revenue = g.Sum(x => OrderMetrics.ComputeParentItemTotal(
                    x.ParentItem,
                    x.Order.OrderItems.Where(child =>
                        child.ParentOrderItemId == x.ParentItem.Id && child.BundlePromotionId == null),
                    addOnOverridePrices)),
                IsBundle = false
            })
            .ToList();

        var bundleGroupCandidates = orders
            .Where(o => SalesRules.IsSale(o.StatusId))
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
            orders.Count(o => o.StatusId == OrderStatuses.Pending),
            orders.Count(o => o.StatusId == OrderStatuses.Completed),
            orders.Count(o => o.StatusId == OrderStatuses.Cancelled),
            orders.Count(o => o.StatusId == OrderStatuses.Refunded));
    }

    private static List<HourlyRevenuePointDto> ComputeHourlyRevenue(
        List<Order> orders,
        DateRangeInfo range,
        DateTime nowLocal,
        TimeZoneInfo timeZone,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        // For partial days (e.g. "Today"), only up to current hour; for complete days, all 24 hours
        var isPartialDay = nowLocal >= range.PrimaryStartLocal && nowLocal < range.PrimaryEndLocal;
        var maxHour = isPartialDay ? nowLocal.Hour : 23;

        return Enumerable.Range(0, maxHour + 1)
            .Select(hour =>
            {
                var hourOrders = orders
                    .Where(o => ReportPeriods.LocalHour(o.CreatedAt, timeZone) == hour)
                    .ToList();
                var summary = SalesRules.Summarize(hourOrders, addOnOverridePrices);
                return new HourlyRevenuePointDto(hour, summary.Revenue, summary.TotalOrderCount, summary.Tips);
            })
            .ToList();
    }

    private static List<DailyRevenuePointDto> ComputeDailyRevenue(
        List<Order> orders,
        DateRangeInfo range,
        TimeZoneInfo timeZone,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        var days = (int)(range.PrimaryEndLocal - range.PrimaryStartLocal).TotalDays;

        return Enumerable.Range(0, days)
            .Select(offset =>
            {
                var date = range.PrimaryStartLocal.AddDays(offset);
                var dayOrders = orders
                    .Where(o => ReportPeriods.LocalDate(o.CreatedAt, timeZone) == date)
                    .ToList();
                var summary = SalesRules.Summarize(dayOrders, addOnOverridePrices);
                return new DailyRevenuePointDto(date, summary.Revenue, summary.TotalOrderCount, summary.Tips);
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
            .Where(o => o.StatusId != (int)OrderStatusEnum.PendingApproval)
            .OrderByDescending(o => o.CreatedAt)
            .Take(5)
            .ToListAsync(cancellationToken);

        var recentOverridePrices = await AddOnPriceLookup.ForOrdersAsync(db, recentOrderEntities, cancellationToken);

        return recentOrderEntities.Select(o =>
        {
            var total = OrderMetrics.ComputeOrderTotal(o, recentOverridePrices);
            return new RecentOrderDto(o.Id, o.OrderNumber, o.CreatedAt, total, o.StatusId, o.Status.Name);
        }).ToList();
    }

    private static List<PaymentMethodBreakdownDto> ComputePaymentMethods(
        List<Order> orders,
        IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> addOnOverridePrices)
    {
        return orders
            .Where(o => SalesRules.IsSale(o.StatusId) && o.PaymentMethodId.HasValue)
            .GroupBy(o => o.PaymentMethod!.Name)
            .Select(g => new PaymentMethodBreakdownDto(
                g.Key,
                g.Count(),
                g.Sum(o => OrderMetrics.ComputeOrderTotal(o, addOnOverridePrices))))
            .OrderByDescending(p => p.Total)
            .ToList();
    }

    private static DateTime ToUtc(DateTime localDateTime, TimeZoneInfo timeZone)
    {
        return TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localDateTime, DateTimeKind.Unspecified),
            timeZone);
    }

}
