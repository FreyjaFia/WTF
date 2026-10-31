using System.Globalization;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Calculations.Inventory;
using WTF.Calculations.Sales;
using static WTF.Api.Endpoints.ReportFormat;

namespace WTF.Api.Endpoints;

internal static class ReportTables
{
    public static ReportTable<DailySalesReportRowDto> DailySales(ReportGroupByEnum groupBy) => new(
        "Daily Sales Summary",
        [
            new("periodStart", "Period", r => FormatPeriodLabel(r.PeriodStart, groupBy), r => r.PeriodStart, false, 1.7f),
            new("grossSales", "Gross Sales", r => Money(r.GrossSales), r => r.GrossSales, true, 1.3f, rows => Money(rows.Sum(r => r.GrossSales))),
            new("discounts", "Discounts", r => Money(r.Discounts), r => r.Discounts, true, 1.2f, rows => Money(rows.Sum(r => r.Discounts))),
            new("refundedAmount", "Refunded", r => Money(r.RefundedAmount), r => r.RefundedAmount, true, 1.2f, rows => Money(rows.Sum(r => r.RefundedAmount))),
            new("netSales", "Net Sales", r => Money(r.NetSales), r => r.NetSales, true, 1.3f, rows => Money(rows.Sum(r => r.NetSales))),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.8f, rows => Number(rows.Sum(r => r.OrderCount))),
            new("averageOrderValue", "Avg/Order", r => Money(r.AverageOrderValue), r => r.AverageOrderValue, true, 1.2f, rows => Money(SalesRules.Average(rows.Sum(r => r.NetSales), rows.Sum(r => r.OrderCount)))),
            new("tipsTotal", "Tips", r => Money(r.TipsTotal), r => r.TipsTotal, true, 1f, rows => Money(rows.Sum(r => r.TipsTotal))),
            new("voidCancelledCount", "Void/Cancelled", r => Number(r.VoidCancelledCount), r => r.VoidCancelledCount, true, 1f, rows => Number(rows.Sum(r => r.VoidCancelledCount)))
        ],
        rows =>
        {
            var net = rows.Sum(r => r.NetSales);
            var orders = rows.Sum(r => r.OrderCount);
            return
            [
                ("Gross Sales", Money(rows.Sum(r => r.GrossSales))),
                ("Discounts", Money(rows.Sum(r => r.Discounts))),
                ("Refunded", Money(rows.Sum(r => r.RefundedAmount))),
                ("Net Sales", Money(net)),
                ("Total Orders", Number(orders)),
                ("Average Order Value", Money(SalesRules.Average(net, orders))),
                ("Total Tips", Money(rows.Sum(r => r.TipsTotal))),
                ("Void/Cancelled", Number(rows.Sum(r => r.VoidCancelledCount)))
            ];
        });

    public static readonly ReportTable<ProductSalesReportRowDto> ProductSales = new(
        "Product Sales Breakdown",
        [
            new("productName", "Product", r => r.ProductName, r => r.ProductName, false, 2.4f),
            new("categoryName", "Category", r => r.CategoryName, r => r.CategoryName, false, 1.3f),
            new("subCategoryName", "Subcategory/Type", r => string.IsNullOrWhiteSpace(r.SubCategoryName) ? "-" : r.SubCategoryName!, r => r.SubCategoryName ?? string.Empty, false, 1.3f),
            new("quantitySold", "Qty", r => Number(r.QuantitySold), r => r.QuantitySold, true, 0.7f, rows => Number(rows.Sum(r => r.QuantitySold))),
            new("grossSales", "Gross", r => Money(r.GrossSales), r => r.GrossSales, true, 1.3f, rows => Money(rows.Sum(r => r.GrossSales))),
            new("discounts", "Discount", r => Money(r.Discounts), r => r.Discounts, true, 1.2f, rows => Money(rows.Sum(r => r.Discounts))),
            new("refundedAmount", "Refunded", r => Money(r.RefundedAmount), r => r.RefundedAmount, true, 1.2f, rows => Money(rows.Sum(r => r.RefundedAmount))),
            new("revenue", "Net", r => Money(r.Revenue), r => r.Revenue, true, 1.3f, rows => Money(rows.Sum(r => r.Revenue))),
            new("revenuePercent", "Net %", r => Percent(r.RevenuePercent), r => r.RevenuePercent, true, 0.9f, rows => Percent(rows.Sum(r => r.RevenuePercent)))
        ],
        rows =>
        [
            ("Gross", Money(rows.Sum(r => r.GrossSales))),
            ("Discounts", Money(rows.Sum(r => r.Discounts))),
            ("Refunded", Money(rows.Sum(r => r.RefundedAmount))),
            ("Net Revenue", Money(rows.Sum(r => r.Revenue))),
            ("Total Quantity", Number(rows.Sum(r => r.QuantitySold)))
        ]);

    public static readonly ReportTable<ProductMarginReportRowDto> ProductMargin = new(
        "Product Profit",
        [
            new("productName", "Product", r => r.ProductName, r => r.ProductName, false, 2.4f),
            new("categoryName", "Category", r => r.CategoryName, r => r.CategoryName, false, 1.3f),
            new("quantitySold", "Qty", r => Number(r.QuantitySold), r => r.QuantitySold, true, 0.7f, rows => Number(rows.Sum(r => r.QuantitySold))),
            new("revenue", "Net", r => Money(r.Revenue), r => r.Revenue, true, 1.3f, rows => Money(rows.Sum(r => r.Revenue))),
            new("cost", "Cost", r => r.Cost.HasValue ? Money(r.Cost.Value) : "-", r => r.Cost, true, 1.3f, rows => Money(rows.Sum(r => r.Cost ?? 0m))),
            new("grossProfit", "Profit", r => r.GrossProfit.HasValue ? Money(r.GrossProfit.Value) : "-", r => r.GrossProfit, true, 1.3f, rows => Money(rows.Sum(r => r.GrossProfit ?? 0m))),
            new("marginPercent", "Margin %", r => r.MarginPercent.HasValue ? Percent(r.MarginPercent.Value) : "-", r => r.MarginPercent, true, 1f),
            new("costStatus", "Cost", r => r.CostStatus, r => r.CostStatus, false, 1.2f)
        ],
        rows =>
        {
            var known = rows.Where(r => r.GrossProfit.HasValue).ToList();
            var knownRevenue = known.Sum(r => r.Revenue);
            var knownProfit = known.Sum(r => r.GrossProfit ?? 0m);
            return
            [
                ("Net Revenue", Money(rows.Sum(r => r.Revenue))),
                ("Cost (rows with a cost)", Money(known.Sum(r => r.Cost ?? 0m))),
                ("Gross Profit", Money(knownProfit)),
                ("Margin", knownRevenue > 0m ? Percent(Math.Round(knownProfit / knownRevenue * 100m, 2, MidpointRounding.AwayFromZero)) : "-"),
                ("Rows without a full cost", Number(rows.Count(r => !r.GrossProfit.HasValue)))
            ];
        });

    public static readonly ReportTable<CategorySalesReportRowDto> CategorySales = new(
        "Sales by Category",
        [
            new("categoryName", "Category", r => r.CategoryName, r => r.CategoryName, false, 2.4f),
            new("quantitySold", "Qty", r => Number(r.QuantitySold), r => r.QuantitySold, true, 0.8f, rows => Number(rows.Sum(r => r.QuantitySold))),
            new("grossSales", "Gross", r => Money(r.GrossSales), r => r.GrossSales, true, 1.4f, rows => Money(rows.Sum(r => r.GrossSales))),
            new("discounts", "Discount", r => Money(r.Discounts), r => r.Discounts, true, 1.3f, rows => Money(rows.Sum(r => r.Discounts))),
            new("refundedAmount", "Refunded", r => Money(r.RefundedAmount), r => r.RefundedAmount, true, 1.3f, rows => Money(rows.Sum(r => r.RefundedAmount))),
            new("revenue", "Net", r => Money(r.Revenue), r => r.Revenue, true, 1.4f, rows => Money(rows.Sum(r => r.Revenue))),
            new("revenuePercent", "Net %", r => Percent(r.RevenuePercent), r => r.RevenuePercent, true, 0.9f, rows => Percent(rows.Sum(r => r.RevenuePercent)))
        ],
        rows =>
        [
            ("Gross", Money(rows.Sum(r => r.GrossSales))),
            ("Discounts", Money(rows.Sum(r => r.Discounts))),
            ("Refunded", Money(rows.Sum(r => r.RefundedAmount))),
            ("Net Revenue", Money(rows.Sum(r => r.Revenue)))
        ]);

    public static readonly ReportTable<PaymentsReportRowDto> Payments = new(
        "Payment Method Breakdown",
        [
            new("paymentMethod", "Payment Method", r => r.PaymentMethod, r => r.PaymentMethod, false, 2.4f),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.9f, rows => Number(rows.Sum(r => r.OrderCount))),
            new("grossSales", "Gross", r => Money(r.GrossSales), r => r.GrossSales, true, 1.4f, rows => Money(rows.Sum(r => r.GrossSales))),
            new("discounts", "Discount", r => Money(r.Discounts), r => r.Discounts, true, 1.3f, rows => Money(rows.Sum(r => r.Discounts))),
            new("refundedAmount", "Refunded", r => Money(r.RefundedAmount), r => r.RefundedAmount, true, 1.3f, rows => Money(rows.Sum(r => r.RefundedAmount))),
            new("totalAmount", "Net", r => Money(r.TotalAmount), r => r.TotalAmount, true, 1.4f, rows => Money(rows.Sum(r => r.TotalAmount))),
            new("tips", "Tips", r => Money(r.Tips), r => r.Tips, true, 1f, rows => Money(rows.Sum(r => r.Tips))),
            new("totalPercent", "Net %", r => Percent(r.TotalPercent), r => r.TotalPercent, true, 0.9f, rows => Percent(rows.Sum(r => r.TotalPercent)))
        ],
        rows =>
        [
            ("Gross", Money(rows.Sum(r => r.GrossSales))),
            ("Discounts", Money(rows.Sum(r => r.Discounts))),
            ("Refunded", Money(rows.Sum(r => r.RefundedAmount))),
            ("Net Amount", Money(rows.Sum(r => r.TotalAmount))),
            ("Total Orders", Number(rows.Sum(r => r.OrderCount))),
            ("Total Tips", Money(rows.Sum(r => r.Tips)))
        ]);

    public static readonly ReportTable<HourlySalesReportRowDto> Hourly = new(
        "Hourly Sales Distribution",
        [
            new("hour", "Hour Range", r => $"{r.Hour:00}:00 - {(r.Hour + 1) % 24:00}:00", r => r.Hour, false, 2f),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.9f, rows => Number(rows.Sum(r => r.OrderCount))),
            new("grossSales", "Gross", r => Money(r.GrossSales), r => r.GrossSales, true, 1.4f, rows => Money(rows.Sum(r => r.GrossSales))),
            new("discounts", "Discount", r => Money(r.Discounts), r => r.Discounts, true, 1.3f, rows => Money(rows.Sum(r => r.Discounts))),
            new("refundedAmount", "Refunded", r => Money(r.RefundedAmount), r => r.RefundedAmount, true, 1.3f, rows => Money(rows.Sum(r => r.RefundedAmount))),
            new("revenue", "Net", r => Money(r.Revenue), r => r.Revenue, true, 1.4f, rows => Money(rows.Sum(r => r.Revenue)))
        ],
        rows =>
        [
            ("Gross", Money(rows.Sum(r => r.GrossSales))),
            ("Discounts", Money(rows.Sum(r => r.Discounts))),
            ("Refunded", Money(rows.Sum(r => r.RefundedAmount))),
            ("Net Revenue", Money(rows.Sum(r => r.Revenue))),
            ("Total Orders", Number(rows.Sum(r => r.OrderCount)))
        ]);

    public static readonly ReportTable<StaffPerformanceReportRowDto> Staff = new(
        "Staff Performance",
        [
            new("staffName", "Staff", r => r.StaffName, r => r.StaffName, false, 2.2f),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.9f, rows => Number(rows.Sum(r => r.OrderCount))),
            new("grossSales", "Gross", r => Money(r.GrossSales), r => r.GrossSales, true, 1.3f, rows => Money(rows.Sum(r => r.GrossSales))),
            new("discounts", "Discount", r => Money(r.Discounts), r => r.Discounts, true, 1.2f, rows => Money(rows.Sum(r => r.Discounts))),
            new("refundedAmount", "Refunded", r => Money(r.RefundedAmount), r => r.RefundedAmount, true, 1.2f, rows => Money(rows.Sum(r => r.RefundedAmount))),
            new("totalRevenue", "Net", r => Money(r.TotalRevenue), r => r.TotalRevenue, true, 1.3f, rows => Money(rows.Sum(r => r.TotalRevenue))),
            new("averageOrderValue", "Avg/Order", r => Money(r.AverageOrderValue), r => r.AverageOrderValue, true, 1.2f, rows => Money(SalesRules.Average(rows.Sum(r => r.TotalRevenue), rows.Sum(r => r.OrderCount)))),
            new("tipsReceived", "Tips", r => Money(r.TipsReceived), r => r.TipsReceived, true, 1f, rows => Money(rows.Sum(r => r.TipsReceived)))
        ],
        rows =>
        {
            var revenue = rows.Sum(r => r.TotalRevenue);
            var orders = rows.Sum(r => r.OrderCount);
            return
            [
                ("Gross", Money(rows.Sum(r => r.GrossSales))),
                ("Discounts", Money(rows.Sum(r => r.Discounts))),
                ("Refunded", Money(rows.Sum(r => r.RefundedAmount))),
                ("Net Revenue", Money(revenue)),
                ("Total Orders", Number(orders)),
                ("Average Order Value", Money(SalesRules.Average(revenue, orders))),
                ("Total Tips", Money(rows.Sum(r => r.TipsReceived)))
            ];
        });

    public static readonly ReportTable<DailyCloseReportRowDto> DailyClose = new(
        "Daily Close",
        [
            new("section", "Section", r => r.Section, r => r.Section, false, 1f),
            new("label", "Item", r => r.Label, r => r.Label, false, 2f),
            new("detail", "Details", r => r.Detail ?? "-", r => r.Detail ?? string.Empty, false, 3f),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.8f),
            new("amount", "Amount", r => r.Quantity.HasValue ? WasteQuantity(r.Quantity.Value, r.UnitName) : Money(r.Amount), r => r.Quantity ?? r.Amount, true, 1.4f)
        ],
        rows =>
        {
            var sales = rows.Where(r => r.Section == "Sales").ToList();
            decimal AmountOf(string label) => sales.FirstOrDefault(r => r.Label == label)?.Amount ?? 0m;
            return
            [
                ("Gross Sales", Money(AmountOf("Gross sales"))),
                ("Refunds", Money(AmountOf("Refunds"))),
                ("Net Sales", Money(AmountOf("Net sales"))),
                ("Tips", Money(AmountOf("Tips")))
            ];
        });

    public static readonly ReportTable<VoidedOrderReportRowDto> Voids = new(
        "Voids and Refunds",
        [
            new("orderNumber", "Order", r => $"#{r.OrderNumber}", r => r.OrderNumber, false, 0.8f),
            new("orderedAt", "Ordered", r => Date(r.OrderedAt), r => r.OrderedAt, false, 1.5f),
            new("voidedAt", "Voided", r => r.VoidedAt.HasValue ? Date(r.VoidedAt.Value) : "-", r => r.VoidedAt, false, 1.5f),
            new("kind", "Type", r => r.Kind, r => r.Kind, false, 1f),
            new("staffName", "Staff", r => r.StaffName, r => r.StaffName, false, 1.3f),
            new("voidedBy", "Voided By", r => r.VoidedBy ?? "-", r => r.VoidedBy ?? string.Empty, false, 1.3f),
            new("amount", "Amount", r => Money(r.Amount), r => r.Amount, true, 1.2f, rows => Money(rows.Sum(r => r.Amount))),
            new("reason", "Reason", r => r.Reason ?? "-", r => r.Reason ?? string.Empty, false, 2f),
            new("staffVoidRate", "Staff Void Rate", r => Percent(r.StaffVoidRate), r => r.StaffVoidRate, true, 1f)
        ],
        rows =>
        [
            ("Voided Orders", Number(rows.Count)),
            ("Refunded", Money(rows.Where(r => r.Kind == "Refunded").Sum(r => r.Amount))),
            ("Cancelled or Rejected", Number(rows.Count(r => r.Kind != "Refunded")))
        ]);

    public static readonly ReportTable<PromotionPerformanceReportRowDto> Promotions = new(
        "Promotions Performance",
        [
            new("promotionName", "Promotion", r => r.PromotionName, r => r.PromotionName, false, 3f),
            new("promotionType", "Type", r => r.PromotionType, r => r.PromotionType, false, 1.8f),
            new("uses", "Uses", r => Number(r.Uses), r => r.Uses, true, 0.9f, rows => Number(rows.Sum(r => r.Uses))),
            new("revenue", "Revenue", r => Money(r.Revenue), r => r.Revenue, true, 1.5f, rows => Money(rows.Sum(r => r.Revenue))),
            new("discountGiven", "Discount Given", r => r.DiscountGiven.HasValue ? Money(r.DiscountGiven.Value) : "-", r => r.DiscountGiven, true, 1.5f, rows => Money(rows.Sum(r => r.DiscountGiven ?? 0m)))
        ],
        rows =>
        [
            ("Total Uses", Number(rows.Sum(r => r.Uses))),
            ("Total Revenue", Money(rows.Sum(r => r.Revenue))),
            ("Discount Given", Money(rows.Sum(r => r.DiscountGiven ?? 0m)))
        ]);

    public static readonly ReportTable<CustomerLinkReportRowDto> CustomerLinks = new(
        "Customer Link Orders",
        [
            new("customerName", "Customer", r => r.CustomerName, r => r.CustomerName, false, 1.8f),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.8f),
            new("acceptedCount", "Accepted", r => Number(r.AcceptedCount), r => r.AcceptedCount, true, 0.9f, rows => Number(rows.Sum(r => r.AcceptedCount))),
            new("rejectedCount", "Rejected", r => Number(r.RejectedCount), r => r.RejectedCount, true, 0.9f, rows => Number(rows.Sum(r => r.RejectedCount))),
            new("awaitingCount", "Awaiting", r => Number(r.AwaitingCount), r => r.AwaitingCount, true, 0.9f, rows => Number(rows.Sum(r => r.AwaitingCount))),
            new("pickupCount", "Pickup", r => Number(r.PickupCount), r => r.PickupCount, true, 0.8f, rows => Number(rows.Sum(r => r.PickupCount))),
            new("deliveryCount", "Delivery", r => Number(r.DeliveryCount), r => r.DeliveryCount, true, 0.9f, rows => Number(rows.Sum(r => r.DeliveryCount))),
            new("revenue", "Revenue", r => Money(r.Revenue), r => r.Revenue, true, 1.3f, rows => Money(rows.Sum(r => r.Revenue))),
            new("averageMinutesToAccept", "To Accept", r => Minutes(r.AverageMinutesToAccept), r => r.AverageMinutesToAccept, true, 1f),
            new("averageMinutesToReady", "To Ready", r => Minutes(r.AverageMinutesToReady), r => r.AverageMinutesToReady, true, 1f),
            new("rejectionReasons", "Rejection Reasons", r => r.RejectionReasons ?? "-", r => r.RejectionReasons ?? string.Empty, false, 2f)
        ],
        rows =>
        [
            ("Orders", Number(rows.Sum(r => r.OrderCount))),
            ("Accepted", Number(rows.Sum(r => r.AcceptedCount))),
            ("Rejected", Number(rows.Sum(r => r.RejectedCount))),
            ("Revenue", Money(rows.Sum(r => r.Revenue)))
        ]);

    public static readonly ReportTable<CustomerReportRowDto> Customers = new(
        "Customers",
        [
            new("customerName", "Customer", r => r.CustomerName, r => r.CustomerName, false, 2.4f),
            new("isNew", "Type", r => r.IsNew ? "New" : "Returning", r => r.IsNew, false, 1.1f),
            new("orderCount", "Orders", r => Number(r.OrderCount), r => r.OrderCount, true, 0.9f),
            new("totalSpent", "Spent", r => Money(r.TotalSpent), r => r.TotalSpent, true, 1.4f, rows => Money(rows.Sum(r => r.TotalSpent))),
            new("averageOrderValue", "Avg/Order", r => Money(r.AverageOrderValue), r => r.AverageOrderValue, true, 1.4f),
            new("lastVisit", "Last Visit", r => Date(r.LastVisit), r => r.LastVisit, false, 1.7f),
            new("loyaltyPoints", "Loyalty Points", r => Number(r.LoyaltyPoints), r => r.LoyaltyPoints, true, 1f)
        ],
        rows =>
        [
            ("Customers", Number(rows.Count)),
            ("New", Number(rows.Count(r => r.IsNew))),
            ("Returning", Number(rows.Count(r => !r.IsNew))),
            ("Total Spent", Money(rows.Sum(r => r.TotalSpent)))
        ]);

    public static readonly ReportTable<StockStatusReportRowDto> StockStatus = new(
        "Stock Status",
        [
            new("itemName", "Item", r => r.ItemName, r => r.ItemName, false, 2.6f),
            new("status", "Status", r => r.Status, r => r.Status, false, 1.2f),
            new("currentQuantity", "On Hand", r => $"{r.CurrentQuantity.ToString("N2", CultureInfo.InvariantCulture)} {r.UnitName}", r => r.CurrentQuantity, true, 1.4f),
            new("warningQuantity", "Warning At", r => r.WarningQuantity.HasValue ? r.WarningQuantity.Value.ToString("N2", CultureInfo.InvariantCulture) : "-", r => r.WarningQuantity, true, 1f),
            new("criticalQuantity", "Critical At", r => r.CriticalQuantity.HasValue ? r.CriticalQuantity.Value.ToString("N2", CultureInfo.InvariantCulture) : "-", r => r.CriticalQuantity, true, 1f),
            new("costPrice", "Unit Cost", r => r.CostPrice.HasValue ? Money(r.CostPrice.Value) : "-", r => r.CostPrice, true, 1.1f),
            new("stockValue", "Stock Value", r => Money(r.StockValue), r => r.StockValue, true, 1.3f, rows => Money(rows.Sum(r => r.StockValue)))
        ],
        rows =>
        [
            ("Items", Number(rows.Count)),
            ("Out of Stock", Number(rows.Count(r => r.Status == "Out of stock"))),
            ("Critical or Warning", Number(rows.Count(r => r.Status is "Critical" or "Warning"))),
            ("Stock Value", Money(rows.Sum(r => r.StockValue)))
        ]);

    public static readonly ReportTable<WasteReportRowDto> Waste = new(
        "Waste",
        [
            new("label", "Group", r => r.Label, r => r.Label, false, 2.6f),
            new("unitName", "Unit", r => r.UnitName ?? "-", r => r.UnitName ?? string.Empty, false, 0.8f),
            new("entryCount", "Entries", r => Number(r.EntryCount), r => r.EntryCount, true, 1f, rows => Number(rows.Sum(r => r.EntryCount))),
            new("quantity", "Quantity", r => WasteQuantity(r.Quantity, r.UnitName), r => r.Quantity, true, 1.3f, rows => WasteTotal(rows, r => r.Quantity)),
            new("disputedCount", "Disputed", r => Number(r.DisputedCount), r => r.DisputedCount, true, 0.9f, rows => Number(rows.Sum(r => r.DisputedCount))),
            new("disputedQuantity", "Disputed Qty", r => WasteQuantity(r.DisputedQuantity, r.UnitName), r => r.DisputedQuantity, true, 1.2f, rows => WasteTotal(rows, r => r.DisputedQuantity))
        ],
        rows =>
        [
            ("Groups", Number(rows.Count)),
            ("Entries", Number(rows.Sum(r => r.EntryCount))),
            ("Disputed", Number(rows.Sum(r => r.DisputedCount)))
        ]);

    public static string FormatPeriodLabel(DateTime periodStart, ReportGroupByEnum groupBy)
    {
        if (groupBy == ReportGroupByEnum.Month)
        {
            return periodStart.ToString("MMMM yyyy", CultureInfo.InvariantCulture);
        }

        if (groupBy == ReportGroupByEnum.Week)
        {
            var weekEnd = periodStart.Date.AddDays(6);
            return $"{periodStart:MMMM dd} - {weekEnd:MMMM dd, yyyy}";
        }

        var dateLabel = periodStart.ToString("MMMM dd, yyyy", CultureInfo.InvariantCulture);
        var dayLabel = periodStart.ToString("ddd", CultureInfo.InvariantCulture);
        return $"{dateLabel} ({dayLabel})";
    }

    public static string WasteQuantity(decimal quantity, string? unitName)
    {
        var unit = WasteRules.NormalizeUnit(unitName);

        if (unit.Length == 0)
        {
            return "-";
        }

        return $"{quantity.ToString("N2", CultureInfo.InvariantCulture)} {unit}";
    }

    private static string WasteTotal(IReadOnlyList<WasteReportRowDto> rows, Func<WasteReportRowDto, decimal> quantity)
    {
        var total = WasteRules.TotalQuantity(rows.Select(r => new WasteEntry(quantity(r), r.UnitName, false)));

        if (!total.HasValue || rows.Count == 0)
        {
            return string.Empty;
        }

        return WasteQuantity(total.Value, rows[0].UnitName);
    }
}
