namespace WTF.Api.Features.Dashboard.DTOs;

public record DashboardDto(
    DailySummaryDto Today,
    List<TopSellingProductDto> TopSellingProducts,
    OrdersByStatusDto OrdersByStatus,
    List<RecentOrderDto> RecentOrders,
    List<HourlyRevenuePointDto> HourlyRevenue,
    List<PaymentMethodBreakdownDto> PaymentMethods);
