using MediatR;
using System.Text;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using System.Globalization;

namespace WTF.Api.Endpoints;

public static class ReportEndpoints
{
    public static IEndpointRouteBuilder MapReports(this IEndpointRouteBuilder app)
    {
        var reportsGroup = app.MapGroup("/api/reports")
            .RequireAuthorization(AppPolicies.ReportsRead);

        reportsGroup.MapGet("/daily-sales",
            async (HttpContext httpContext, [AsParameters] GetDailySalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateDateRange(query.FromDate, query.ToDate);
                if (validationResult != null)
                {
                    return validationResult;
                }

                if (!Enum.IsDefined(query.GroupBy))
                {
                    return Results.BadRequest($"groupBy must be one of: {nameof(ReportGroupByEnum.Day)}, {nameof(ReportGroupByEnum.Week)}, {nameof(ReportGroupByEnum.Month)}.");
                }

                var result = await sender.Send(query);
                return BuildReportResponse(
                    httpContext,
                    result,
                    $"daily-sales-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.csv",
                    $"daily-sales-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.pdf",
                    BuildDailySalesCsv,
                    rows => BuildDailySalesPdfDocument(rows, query.FromDate, query.ToDate, query.GroupBy));
            });

        reportsGroup.MapGet("/product-sales",
            async (HttpContext httpContext, [AsParameters] GetProductSalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateDateRange(query.FromDate, query.ToDate);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(
                    httpContext,
                    result,
                    $"product-sales-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.csv",
                    $"product-sales-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.pdf",
                    BuildProductSalesCsv,
                    rows => BuildProductSalesPdfDocument(rows, query.FromDate, query.ToDate));
            });

        reportsGroup.MapGet("/payments",
            async (HttpContext httpContext, [AsParameters] GetPaymentsReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateDateRange(query.FromDate, query.ToDate);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(
                    httpContext,
                    result,
                    $"payments-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.csv",
                    $"payments-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.pdf",
                    BuildPaymentsCsv,
                    rows => BuildPaymentsPdfDocument(rows, query.FromDate, query.ToDate));
            });

        reportsGroup.MapGet("/hourly",
            async (HttpContext httpContext, [AsParameters] GetHourlySalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateDateRange(query.FromDate, query.ToDate);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(
                    httpContext,
                    result,
                    $"hourly-sales-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.csv",
                    $"hourly-sales-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.pdf",
                    BuildHourlySalesCsv,
                    rows => BuildHourlySalesPdfDocument(rows, query.FromDate, query.ToDate));
            });

        reportsGroup.MapGet("/staff",
            async (HttpContext httpContext, [AsParameters] GetStaffPerformanceReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateDateRange(query.FromDate, query.ToDate);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(
                    httpContext,
                    result,
                    $"staff-performance-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.csv",
                    $"staff-performance-{query.FromDate:yyyyMMdd}-{query.ToDate:yyyyMMdd}.pdf",
                    BuildStaffPerformanceCsv,
                    rows => BuildStaffPerformancePdfDocument(rows, query.FromDate, query.ToDate));
            });

        return app;
    }

    private static string BuildDailySalesCsv(IReadOnlyList<DailySalesReportRowDto> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("PeriodStartUtc,TotalRevenue,OrderCount,AverageOrderValue,TipsTotal,VoidCancelledCount");

        foreach (var row in rows)
        {
            builder.AppendLine(
                $"{row.PeriodStart:yyyy-MM-dd},{row.TotalRevenue:F2},{row.OrderCount},{row.AverageOrderValue:F2},{row.TipsTotal:F2},{row.VoidCancelledCount}");
        }

        var totalsRevenue = rows.Sum(r => r.TotalRevenue);
        var totalsOrders = rows.Sum(r => r.OrderCount);
        var totalsTips = rows.Sum(r => r.TipsTotal);
        var totalsVoidCancelled = rows.Sum(r => r.VoidCancelledCount);
        var totalsAverage = totalsOrders > 0 ? totalsRevenue / totalsOrders : 0m;

        builder.AppendLine(
            $"TOTAL,{totalsRevenue:F2},{totalsOrders},{totalsAverage:F2},{totalsTips:F2},{totalsVoidCancelled}");
        return builder.ToString();
    }

    private static IResult? ValidateDateRange(DateTime fromDate, DateTime toDate)
    {
        if (fromDate == default || toDate == default)
        {
            return Results.BadRequest("fromDate and toDate are required.");
        }

        if (toDate.Date < fromDate.Date)
        {
            return Results.BadRequest("toDate must be greater than or equal to fromDate.");
        }

        return null;
    }

    private static IResult BuildReportResponse<T>(
        HttpContext httpContext,
        IReadOnlyList<T> rows,
        string csvFileName,
        string pdfFileName,
        Func<IReadOnlyList<T>, string> csvBuilder,
        Func<IReadOnlyList<T>, SimplePdfBuilder.PdfDocument> pdfDocumentBuilder)
    {
        var accepts = httpContext.Request.Headers.Accept.ToString();

        if (accepts.Contains("text/csv", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var csv = csvBuilder(rows);
                var bytes = Encoding.UTF8.GetBytes(csv);
                return Results.File(bytes, "text/csv; charset=utf-8", csvFileName);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    title: "CSV export failed",
                    detail: ex.Message,
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }

        if (accepts.Contains("application/pdf", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var pdfDocument = pdfDocumentBuilder(rows);
                var pdfBytes = SimplePdfBuilder.Build(pdfDocument);
                return Results.File(pdfBytes, "application/pdf", pdfFileName);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    title: "PDF export failed",
                    detail: ex.Message,
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }

        return Results.Ok(rows);
    }

    private static string BuildProductSalesCsv(IReadOnlyList<ProductSalesReportRowDto> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("ProductId,ProductName,Category,SubCategory,QuantitySold,Revenue,RevenuePercent");

        foreach (var row in rows)
        {
            builder.AppendLine(
                $"{row.ProductId},{EscapeCsv(row.ProductName)},{EscapeCsv(row.CategoryName)},{EscapeCsv(row.SubCategoryName ?? string.Empty)},{row.QuantitySold},{row.Revenue:F2},{row.RevenuePercent:F2}");
        }

        var totalQuantity = rows.Sum(r => r.QuantitySold);
        var totalRevenue = rows.Sum(r => r.Revenue);
        builder.AppendLine($"TOTAL,,,,{totalQuantity},{totalRevenue:F2},100.00");
        return builder.ToString();
    }

    private static string BuildPaymentsCsv(IReadOnlyList<PaymentsReportRowDto> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("PaymentMethod,OrderCount,TotalAmount,TotalPercent");

        foreach (var row in rows)
        {
            builder.AppendLine(
                $"{EscapeCsv(row.PaymentMethod)},{row.OrderCount},{row.TotalAmount:F2},{row.TotalPercent:F2}");
        }

        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalAmount = rows.Sum(r => r.TotalAmount);
        builder.AppendLine($"TOTAL,{totalOrders},{totalAmount:F2},100.00");
        return builder.ToString();
    }

    private static string BuildHourlySalesCsv(IReadOnlyList<HourlySalesReportRowDto> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("Hour,OrderCount,Revenue");

        foreach (var row in rows)
        {
            builder.AppendLine($"{row.Hour},{row.OrderCount},{row.Revenue:F2}");
        }

        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalRevenue = rows.Sum(r => r.Revenue);
        builder.AppendLine($"TOTAL,{totalOrders},{totalRevenue:F2}");
        return builder.ToString();
    }

    private static string BuildStaffPerformanceCsv(IReadOnlyList<StaffPerformanceReportRowDto> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("StaffId,StaffName,OrderCount,TotalRevenue,AverageOrderValue,TipsReceived");

        foreach (var row in rows)
        {
            builder.AppendLine(
                $"{row.StaffId},{EscapeCsv(row.StaffName)},{row.OrderCount},{row.TotalRevenue:F2},{row.AverageOrderValue:F2},{row.TipsReceived:F2}");
        }

        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalTips = rows.Sum(r => r.TipsReceived);
        var averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0m;
        builder.AppendLine($"TOTAL,,{totalOrders},{totalRevenue:F2},{averageOrder:F2},{totalTips:F2}");
        return builder.ToString();
    }

    private static SimplePdfBuilder.PdfDocument BuildDailySalesPdfDocument(
        IReadOnlyList<DailySalesReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate,
        ReportGroupByEnum groupBy)
    {
        var columns = new List<SimplePdfBuilder.PdfTableColumn>
        {
            new("Period", 120f),
            new("Revenue", 92f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Orders", 64f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Avg/Order", 92f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Tips", 80f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Void/Cancelled", 84f, SimplePdfBuilder.PdfTextAlign.Right)
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                FormatPeriodLabel(row.PeriodStart, groupBy),
                FormatMoney(row.TotalRevenue),
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.AverageOrderValue),
                FormatMoney(row.TipsTotal),
                row.VoidCancelledCount.ToString("N0", CultureInfo.InvariantCulture)
            ]);
        }

        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalTips = rows.Sum(r => r.TipsTotal);
        var totalVoidCancelled = rows.Sum(r => r.VoidCancelledCount);
        var averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0m;

        var summary = new List<SimplePdfBuilder.PdfSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture)),
            new("Average Order Value", FormatMoney(averageOrder)),
            new("Total Tips", FormatMoney(totalTips)),
            new("Void/Cancelled", totalVoidCancelled.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimplePdfBuilder.PdfDocument(
            "Daily Sales Summary",
            BuildDateRangeSubtitle(fromDate, toDate),
            new SimplePdfBuilder.PdfTable(columns, tableRows),
            summary);
    }

    private static SimplePdfBuilder.PdfDocument BuildProductSalesPdfDocument(
        IReadOnlyList<ProductSalesReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimplePdfBuilder.PdfTableColumn>
        {
            new("Product", 158f),
            new("Category", 90f),
            new("Subcategory", 90f),
            new("Qty", 52f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Revenue", 88f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Revenue %", 54f, SimplePdfBuilder.PdfTextAlign.Right)
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                row.ProductName,
                row.CategoryName,
                string.IsNullOrWhiteSpace(row.SubCategoryName) ? "-" : row.SubCategoryName!,
                row.QuantitySold.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.Revenue),
                $"{row.RevenuePercent:N2}%"
            ]);
        }

        var totalRevenue = rows.Sum(r => r.Revenue);
        var totalQuantity = rows.Sum(r => r.QuantitySold);

        var summary = new List<SimplePdfBuilder.PdfSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Quantity", totalQuantity.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimplePdfBuilder.PdfDocument(
            "Product Sales Breakdown",
            BuildDateRangeSubtitle(fromDate, toDate),
            new SimplePdfBuilder.PdfTable(columns, tableRows),
            summary);
    }

    private static SimplePdfBuilder.PdfDocument BuildPaymentsPdfDocument(
        IReadOnlyList<PaymentsReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimplePdfBuilder.PdfTableColumn>
        {
            new("Payment Method", 230f),
            new("Orders", 90f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Amount", 130f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Total %", 82f, SimplePdfBuilder.PdfTextAlign.Right)
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                row.PaymentMethod,
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalAmount),
                $"{row.TotalPercent:N2}%"
            ]);
        }

        var totalAmount = rows.Sum(r => r.TotalAmount);
        var totalOrders = rows.Sum(r => r.OrderCount);

        var summary = new List<SimplePdfBuilder.PdfSummaryItem>
        {
            new("Total Amount", FormatMoney(totalAmount)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimplePdfBuilder.PdfDocument(
            "Payment Method Breakdown",
            BuildDateRangeSubtitle(fromDate, toDate),
            new SimplePdfBuilder.PdfTable(columns, tableRows),
            summary);
    }

    private static SimplePdfBuilder.PdfDocument BuildHourlySalesPdfDocument(
        IReadOnlyList<HourlySalesReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimplePdfBuilder.PdfTableColumn>
        {
            new("Hour Range", 220f),
            new("Orders", 110f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Revenue", 202f, SimplePdfBuilder.PdfTextAlign.Right)
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                $"{row.Hour:00}:00 - {((row.Hour + 1) % 24):00}:00",
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.Revenue)
            ]);
        }

        var totalRevenue = rows.Sum(r => r.Revenue);
        var totalOrders = rows.Sum(r => r.OrderCount);

        var summary = new List<SimplePdfBuilder.PdfSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimplePdfBuilder.PdfDocument(
            "Hourly Sales Distribution",
            BuildDateRangeSubtitle(fromDate, toDate),
            new SimplePdfBuilder.PdfTable(columns, tableRows),
            summary);
    }

    private static SimplePdfBuilder.PdfDocument BuildStaffPerformancePdfDocument(
        IReadOnlyList<StaffPerformanceReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimplePdfBuilder.PdfTableColumn>
        {
            new("Staff", 170f),
            new("Orders", 70f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Revenue", 100f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Avg/Order", 100f, SimplePdfBuilder.PdfTextAlign.Right),
            new("Tips", 92f, SimplePdfBuilder.PdfTextAlign.Right)
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                row.StaffName,
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalRevenue),
                FormatMoney(row.AverageOrderValue),
                FormatMoney(row.TipsReceived)
            ]);
        }

        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalTips = rows.Sum(r => r.TipsReceived);
        var averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0m;

        var summary = new List<SimplePdfBuilder.PdfSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture)),
            new("Average Order Value", FormatMoney(averageOrderValue)),
            new("Total Tips", FormatMoney(totalTips))
        };

        return new SimplePdfBuilder.PdfDocument(
            "Staff Performance",
            BuildDateRangeSubtitle(fromDate, toDate),
            new SimplePdfBuilder.PdfTable(columns, tableRows),
            summary);
    }

    private static string EscapeCsv(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
        {
            return $"\"{value.Replace("\"", "\"\"")}\"";
        }

        return value;
    }

    private static string BuildDateRangeSubtitle(DateTime fromDate, DateTime toDate)
    {
        return $"Date Range: {fromDate:MMM dd, yyyy} - {toDate:MMM dd, yyyy}";
    }

    private static string FormatMoney(decimal value)
    {
        return $"PHP {value.ToString("N2", CultureInfo.InvariantCulture)}";
    }

    private static string FormatPeriodLabel(DateTime periodStart, ReportGroupByEnum groupBy)
    {
        if (groupBy == ReportGroupByEnum.Month)
        {
            return periodStart.ToString("MMMM yyyy", CultureInfo.InvariantCulture);
        }

        if (groupBy == ReportGroupByEnum.Week)
        {
            var weekEnd = periodStart.Date.AddDays(6);
            return $"{periodStart:MMM dd} - {weekEnd:MMM dd, yyyy}";
        }

        return periodStart.ToString("MMM dd, yyyy", CultureInfo.InvariantCulture);
    }
}
