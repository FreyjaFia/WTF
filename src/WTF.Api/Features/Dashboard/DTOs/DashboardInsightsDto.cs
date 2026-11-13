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
    int ReturningCustomers,
    HeldOrdersInsightDto? HeldOrders = null);

public record HeldOrdersInsightDto(
    int Count,
    decimal Amount,
    decimal SeniorPwdDiscount,
    int AgedCount,
    decimal AgedAmount,
    string? AgedText);
