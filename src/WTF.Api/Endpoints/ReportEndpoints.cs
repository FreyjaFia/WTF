using MediatR;
using System.Globalization;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Time;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;

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
                    BuildRangeExportFileName("Daily Sales Summary", query.FromDate, query.ToDate, "xlsx"),
                    BuildRangeExportFileName("Daily Sales Summary", query.FromDate, query.ToDate, "pdf"),
                    rows => BuildDailySalesExcelDocument(rows, query.FromDate, query.ToDate, query.GroupBy),
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
                    BuildRangeExportFileName("Product Sales Breakdown", query.FromDate, query.ToDate, "xlsx"),
                    BuildRangeExportFileName("Product Sales Breakdown", query.FromDate, query.ToDate, "pdf"),
                    rows => BuildProductSalesExcelDocument(rows, query.FromDate, query.ToDate),
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
                    BuildRangeExportFileName("Payment Method Breakdown", query.FromDate, query.ToDate, "xlsx"),
                    BuildRangeExportFileName("Payment Method Breakdown", query.FromDate, query.ToDate, "pdf"),
                    rows => BuildPaymentsExcelDocument(rows, query.FromDate, query.ToDate),
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
                    BuildRangeExportFileName("Hourly Sales Distribution", query.FromDate, query.ToDate, "xlsx"),
                    BuildRangeExportFileName("Hourly Sales Distribution", query.FromDate, query.ToDate, "pdf"),
                    rows => BuildHourlySalesExcelDocument(rows, query.FromDate, query.ToDate),
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
                    BuildRangeExportFileName("Staff Performance", query.FromDate, query.ToDate, "xlsx"),
                    BuildRangeExportFileName("Staff Performance", query.FromDate, query.ToDate, "pdf"),
                    rows => BuildStaffPerformanceExcelDocument(rows, query.FromDate, query.ToDate),
                    rows => BuildStaffPerformancePdfDocument(rows, query.FromDate, query.ToDate));
            });

        reportsGroup.MapGet("/monthly-workbook/status",
            async ([AsParameters] MonthlyWorkbookRequest request, IMonthlyReportWorkbookService workbookService, CancellationToken cancellationToken) =>
            {
                var validation = ValidateMonthRequest(request.Year, request.Month);
                if (validation is not null)
                {
                    return validation;
                }

                var status = await workbookService.GetStatusAsync(
                    request.Year,
                    request.Month,
                    cancellationToken);

                return Results.Ok(status);
            });

        reportsGroup.MapPost("/monthly-workbook/generate",
            async (HttpContext httpContext, [AsParameters] MonthlyWorkbookRequest request, IMonthlyReportWorkbookService workbookService, CancellationToken cancellationToken) =>
            {
                var validation = ValidateMonthRequest(request.Year, request.Month);
                if (validation is not null)
                {
                    return validation;
                }

                var requestedTimeZone = httpContext.Request.Headers["X-TimeZone"].ToString();
                var status = await workbookService.GenerateAsync(
                    request.Year,
                    request.Month,
                    requestedTimeZone,
                    cancellationToken);

                return Results.Ok(status);
            });

        reportsGroup.MapGet("/monthly-workbook/download",
            async ([AsParameters] MonthlyWorkbookRequest request, IMonthlyReportWorkbookService workbookService, CancellationToken cancellationToken) =>
            {
                var validation = ValidateMonthRequest(request.Year, request.Month);
                if (validation is not null)
                {
                    return validation;
                }

                var file = await workbookService.GetFileAsync(
                    request.Year,
                    request.Month,
                    cancellationToken);

                if (file is null)
                {
                    return Results.NotFound("Monthly report workbook is not generated yet.");
                }

                return Results.File(
                    file.Value.Data,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    file.Value.FileName);
            });

        return app;
    }

    private static SimpleExcelBuilder.ExcelDocument BuildDailySalesExcelDocument(
        IReadOnlyList<DailySalesReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate,
        ReportGroupByEnum groupBy)
    {
        var columns = new List<SimpleExcelBuilder.ExcelTableColumn>
        {
            new("Period"),
            new("Revenue", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Orders", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Avg/Order", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Tips", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Void/Cancelled", SimpleExcelBuilder.ExcelTextAlign.Right)
        };

        var rowValues = rows
            .Select(row => (IReadOnlyList<string>)
            [
                FormatPeriodLabel(row.PeriodStart, groupBy),
                FormatMoney(row.TotalRevenue),
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.AverageOrderValue),
                FormatMoney(row.TipsTotal),
                row.VoidCancelledCount.ToString("N0", CultureInfo.InvariantCulture)
            ])
            .ToList();

        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalTips = rows.Sum(r => r.TipsTotal);
        var totalVoidCancelled = rows.Sum(r => r.VoidCancelledCount);
        var averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0m;

        var summary = new List<SimpleExcelBuilder.ExcelSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture)),
            new("Average Order Value", FormatMoney(averageOrder)),
            new("Total Tips", FormatMoney(totalTips)),
            new("Void/Cancelled", totalVoidCancelled.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimpleExcelBuilder.ExcelDocument(
            "Daily Sales Summary",
            BuildDateRangeSubtitle(fromDate, toDate),
            columns,
            rowValues,
            summary);
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

    private static IResult? ValidateMonthRequest(int year, int month)
    {
        if (year < 2000 || year > 2100)
        {
            return Results.BadRequest("year must be between 2000 and 2100.");
        }

        if (month is < 1 or > 12)
        {
            return Results.BadRequest("month must be between 1 and 12.");
        }

        return null;
    }

    private static IResult BuildReportResponse<T>(
        HttpContext httpContext,
        IReadOnlyList<T> rows,
        string excelFileName,
        string pdfFileName,
        Func<IReadOnlyList<T>, SimpleExcelBuilder.ExcelDocument> excelDocumentBuilder,
        Func<IReadOnlyList<T>, SimplePdfBuilder.PdfDocument> pdfDocumentBuilder)
    {
        var accepts = httpContext.Request.Headers.Accept.ToString();
        var generatedAtLabel = BuildGeneratedAtLabel(httpContext);

        if (accepts.Contains("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", StringComparison.OrdinalIgnoreCase)
            || accepts.Contains("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var excelDocument = excelDocumentBuilder(rows) with { GeneratedAtLabel = generatedAtLabel };
                var bytes = SimpleExcelBuilder.Build(excelDocument);
                return Results.File(
                    bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    excelFileName);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    title: "Excel export failed",
                    detail: ex.Message,
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }

        if (accepts.Contains("application/pdf", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var pdfDocument = pdfDocumentBuilder(rows) with { GeneratedAtLabel = generatedAtLabel };
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

    private static SimpleExcelBuilder.ExcelDocument BuildProductSalesExcelDocument(
        IReadOnlyList<ProductSalesReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimpleExcelBuilder.ExcelTableColumn>
        {
            new("Product"),
            new("Category"),
            new("Subcategory"),
            new("Qty", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Revenue", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Revenue %", SimpleExcelBuilder.ExcelTextAlign.Right)
        };

        var rowValues = rows
            .Select(row => (IReadOnlyList<string>)
            [
                row.ProductName,
                row.CategoryName,
                string.IsNullOrWhiteSpace(row.SubCategoryName) ? "-" : row.SubCategoryName!,
                row.QuantitySold.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.Revenue),
                $"{row.RevenuePercent:N2}%"
            ])
            .ToList();

        var totalRevenue = rows.Sum(r => r.Revenue);
        var totalQuantity = rows.Sum(r => r.QuantitySold);
        var summary = new List<SimpleExcelBuilder.ExcelSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Quantity", totalQuantity.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimpleExcelBuilder.ExcelDocument(
            "Product Sales Breakdown",
            BuildDateRangeSubtitle(fromDate, toDate),
            columns,
            rowValues,
            summary);
    }

    private static SimpleExcelBuilder.ExcelDocument BuildPaymentsExcelDocument(
        IReadOnlyList<PaymentsReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimpleExcelBuilder.ExcelTableColumn>
        {
            new("Payment Method"),
            new("Orders", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Amount", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Total %", SimpleExcelBuilder.ExcelTextAlign.Right)
        };

        var rowValues = rows
            .Select(row => (IReadOnlyList<string>)
            [
                row.PaymentMethod,
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalAmount),
                $"{row.TotalPercent:N2}%"
            ])
            .ToList();

        var totalAmount = rows.Sum(r => r.TotalAmount);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var summary = new List<SimpleExcelBuilder.ExcelSummaryItem>
        {
            new("Total Amount", FormatMoney(totalAmount)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimpleExcelBuilder.ExcelDocument(
            "Payment Method Breakdown",
            BuildDateRangeSubtitle(fromDate, toDate),
            columns,
            rowValues,
            summary);
    }

    private static SimpleExcelBuilder.ExcelDocument BuildHourlySalesExcelDocument(
        IReadOnlyList<HourlySalesReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimpleExcelBuilder.ExcelTableColumn>
        {
            new("Hour Range"),
            new("Orders", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Revenue", SimpleExcelBuilder.ExcelTextAlign.Right)
        };

        var rowValues = rows
            .Select(row => (IReadOnlyList<string>)
            [
                $"{row.Hour:00}:00 - {((row.Hour + 1) % 24):00}:00",
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.Revenue)
            ])
            .ToList();

        var totalRevenue = rows.Sum(r => r.Revenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var summary = new List<SimpleExcelBuilder.ExcelSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture))
        };

        return new SimpleExcelBuilder.ExcelDocument(
            "Hourly Sales Distribution",
            BuildDateRangeSubtitle(fromDate, toDate),
            columns,
            rowValues,
            summary);
    }

    private static SimpleExcelBuilder.ExcelDocument BuildStaffPerformanceExcelDocument(
        IReadOnlyList<StaffPerformanceReportRowDto> rows,
        DateTime fromDate,
        DateTime toDate)
    {
        var columns = new List<SimpleExcelBuilder.ExcelTableColumn>
        {
            new("Staff"),
            new("Orders", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Revenue", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Avg/Order", SimpleExcelBuilder.ExcelTextAlign.Right),
            new("Tips", SimpleExcelBuilder.ExcelTextAlign.Right)
        };

        var rowValues = rows
            .Select(row => (IReadOnlyList<string>)
            [
                row.StaffName,
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalRevenue),
                FormatMoney(row.AverageOrderValue),
                FormatMoney(row.TipsReceived)
            ])
            .ToList();

        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalTips = rows.Sum(r => r.TipsReceived);
        var averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0m;
        var summary = new List<SimpleExcelBuilder.ExcelSummaryItem>
        {
            new("Total Revenue", FormatMoney(totalRevenue)),
            new("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture)),
            new("Average Order Value", FormatMoney(averageOrderValue)),
            new("Total Tips", FormatMoney(totalTips))
        };

        return new SimpleExcelBuilder.ExcelDocument(
            "Staff Performance",
            BuildDateRangeSubtitle(fromDate, toDate),
            columns,
            rowValues,
            summary);
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

    private static string BuildDateRangeSubtitle(DateTime fromDate, DateTime toDate)
    {
        return $"Date Range: {fromDate:MMM dd, yyyy} - {toDate:MMM dd, yyyy}";
    }

    private static string BuildRangeExportFileName(
        string reportName,
        DateTime fromDate,
        DateTime toDate,
        string extension)
    {
        var normalizedReportName = string.Join(
            '-',
            reportName
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => new string(part.Where(ch => char.IsLetterOrDigit(ch) || ch == '-').ToArray())));

        return $"WTF-{normalizedReportName}-{fromDate:yyyyMMdd}-{toDate:yyyyMMdd}.{extension}";
    }

    private static string BuildGeneratedAtLabel(HttpContext httpContext)
    {
        var requestedTimeZoneId = httpContext.Request.Headers["X-TimeZone"].ToString();
        var timeZone = RequestTimeZone.Resolve(requestedTimeZoneId);
        var generatedAtLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone);
        var offset = timeZone.GetUtcOffset(generatedAtLocal);
        var offsetSign = offset < TimeSpan.Zero ? "-" : "+";
        var offsetLabel = $"{offsetSign}{Math.Abs(offset.Hours):00}:{Math.Abs(offset.Minutes):00}";
        var timeZoneLabel = string.IsNullOrWhiteSpace(requestedTimeZoneId)
            ? $"UTC{offsetLabel}"
            : $"{requestedTimeZoneId} (UTC{offsetLabel})";

        return $"Generated: {generatedAtLocal.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)} {timeZoneLabel}";
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
            return $"{periodStart:MMMM dd} - {weekEnd:MMMM dd, yyyy}";
        }

        return periodStart.ToString("MMMM dd, yyyy", CultureInfo.InvariantCulture);
    }

    private sealed record MonthlyWorkbookRequest
    {
        public int Year { get; init; }

        public int Month { get; init; }
    }
}
