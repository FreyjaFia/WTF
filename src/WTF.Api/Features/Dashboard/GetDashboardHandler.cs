using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Dashboard.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Dashboard;

public record GetDashboardQuery : IRequest<DashboardDto>;

public class GetDashboardHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetDashboardQuery, DashboardDto>
{
    public async Task<DashboardDto> Handle(GetDashboardQuery request, CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var todayUtc = nowUtc.Date;
        var tomorrowUtc = todayUtc.AddDays(1);
        var yesterdayUtc = todayUtc.AddDays(-1);

        // Time-matched cutoff: same hour boundary yesterday for fair comparison
        var yesterdayCutoff = yesterdayUtc.AddHours(nowUtc.Hour).AddMinutes(nowUtc.Minute);

        // Today's orders
        var todayOrders = await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Include(o => o.PaymentMethod)
            .Where(o => o.CreatedAt >= todayUtc && o.CreatedAt < tomorrowUtc)
            .ToListAsync(cancellationToken);

        // Yesterday's orders up to the same time of day (for fair comparison)
        var yesterdayOrders = await db.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o => o.CreatedAt >= yesterdayUtc && o.CreatedAt <= yesterdayCutoff)
            .ToListAsync(cancellationToken);

        var totalOrders = todayOrders.Count;
        var totalRevenue = todayOrders
            .Where(o => o.StatusId == 2) // Completed
            .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
        var averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        var totalTips = todayOrders.Sum(o => o.Tips ?? 0);
        var totalCustomers = todayOrders
            .Where(o => o.CustomerId.HasValue)
            .Select(o => o.CustomerId)
            .Distinct()
            .Count();

        // Yesterday's metrics
        var yesterdayTotalOrders = yesterdayOrders.Count;
        var yesterdayTotalRevenue = yesterdayOrders
            .Where(o => o.StatusId == 2)
            .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
        var yesterdayAvgOrderValue = yesterdayTotalOrders > 0 ? yesterdayTotalRevenue / yesterdayTotalOrders : 0;
        var yesterdayTotalTips = yesterdayOrders.Sum(o => o.Tips ?? 0);

        var dailySummary = new DailySummaryDto(
            totalOrders,
            totalRevenue,
            averageOrderValue,
            totalTips,
            totalCustomers,
            yesterdayTotalOrders,
            yesterdayTotalRevenue,
            yesterdayAvgOrderValue,
            yesterdayTotalTips);

        // Top selling products today (by quantity) with image
        var topProductGroups = todayOrders
            .Where(o => o.StatusId == 2) // Completed
            .SelectMany(o => o.OrderItems)
            .Where(oi => oi.ParentOrderItemId == null) // Exclude add-ons
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

        var topProducts = topProductGroups.Select(g =>
        {
            productImages.TryGetValue(g.ProductId, out var relativeUrl);
            var absoluteUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, relativeUrl);
            return new TopSellingProductDto(g.ProductId, g.ProductName, g.QuantitySold, g.Revenue, absoluteUrl);
        }).ToList();

        // Orders by status today
        var ordersByStatus = new OrdersByStatusDto(
            todayOrders.Count(o => o.StatusId == 1),
            todayOrders.Count(o => o.StatusId == 2),
            todayOrders.Count(o => o.StatusId == 3),
            todayOrders.Count(o => o.StatusId == 4));

        // Hourly metrics (grouped by UTC hour)
        var currentHour = DateTime.UtcNow.Hour;
        var hourlyRevenue = Enumerable.Range(0, currentHour + 1)
            .Select(hour =>
            {
                var hourOrders = todayOrders
                    .Where(o => o.CreatedAt.Hour == hour)
                    .ToList();
                var revenue = hourOrders
                    .Where(o => o.StatusId == 2)
                    .Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity));
                var orders = hourOrders.Count;
                var tips = hourOrders.Sum(o => o.Tips ?? 0);
                return new HourlyRevenuePointDto(hour, revenue, orders, tips);
            })
            .ToList();

        // Recent orders (last 5 today) — loaded into memory for override-aware totals
        var recentOrderEntities = await db.Orders
            .Include(o => o.Status)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o => o.CreatedAt >= todayUtc && o.CreatedAt < tomorrowUtc)
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
                .Where(o => recentParentProductIds.Contains(o.ProductId) && recentAddOnProductIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        var recentOrders = recentOrderEntities.Select(o =>
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
                            ?? (recentOverridePrices.TryGetValue((oi.ProductId, child.ProductId), out var op) ? op : child.Product.Price);
                        return effectivePrice * child.Quantity;
                    });
                return itemPrice + addOnsPrice;
            });

            return new RecentOrderDto(o.Id, o.OrderNumber, o.CreatedAt, total, o.StatusId, o.Status.Name);
        }).ToList();

        // Payment method breakdown (completed orders today)
        var paymentMethods = todayOrders
            .Where(o => o.StatusId == 2 && o.PaymentMethodId.HasValue)
            .GroupBy(o => o.PaymentMethod!.Name)
            .Select(g => new PaymentMethodBreakdownDto(
                g.Key,
                g.Count(),
                g.Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity))))
            .OrderByDescending(p => p.Total)
            .ToList();

        return new DashboardDto(dailySummary, topProducts, ordersByStatus, recentOrders, hourlyRevenue, paymentMethods);
    }
}
