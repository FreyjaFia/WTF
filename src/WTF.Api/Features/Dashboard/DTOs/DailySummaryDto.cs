namespace WTF.Api.Features.Dashboard.DTOs;

public record DailySummaryDto(
    int TotalOrders,
    decimal TotalRevenue,
    decimal AverageOrderValue,
    decimal TotalTips,
    int TotalCustomers,
    int YesterdayTotalOrders,
    decimal YesterdayTotalRevenue,
    decimal YesterdayAverageOrderValue,
    decimal YesterdayTotalTips);
