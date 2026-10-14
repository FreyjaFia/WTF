namespace WTF.Api.Features.Dashboard.DTOs;

public record DashboardInsightsDto(
    decimal Discounts,
    int RefundedCount,
    decimal RefundedAmount,
    decimal VoidRate,
    int LowStockCount,
    int OutOfStockCount,
    int AwaitingApprovalCount,
    int CustomerLinkOrders,
    decimal CustomerLinkRevenue,
    string? TopPromotionName,
    int TopPromotionUses,
    int NewCustomers,
    int ReturningCustomers);
