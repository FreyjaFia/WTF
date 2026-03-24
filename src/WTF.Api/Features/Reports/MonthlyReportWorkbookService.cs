using ClosedXML.Excel;
using MediatR;
using Microsoft.AspNetCore.Http;
using System.Globalization;
using WTF.Api.Common.Time;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Api.Services;

namespace WTF.Api.Features.Reports;

public interface IMonthlyReportWorkbookService
{
    Task<MonthlyReportWorkbookStatusDto> GenerateAsync(
        int year,
        int month,
        string? requestedTimeZoneId,
        CancellationToken cancellationToken);

    Task<MonthlyReportWorkbookStatusDto> GenerateThroughDateAsync(
        int year,
        int month,
        DateTime throughDateLocal,
        string? requestedTimeZoneId,
        CancellationToken cancellationToken);

    Task<MonthlyReportWorkbookStatusDto> GetStatusAsync(
        int year,
        int month,
        CancellationToken cancellationToken);

    Task<(byte[] Data, string FileName)?> GetFileAsync(
        int year,
        int month,
        CancellationToken cancellationToken);
}

public sealed class MonthlyReportWorkbookService(
    ISender sender,
    IHttpContextAccessor httpContextAccessor,
    IReportFileStorage storage) : IMonthlyReportWorkbookService
{
    private sealed record WorksheetSummaryItem(string Label, string Value);

    private const string CompanyName = "Wake.Taste.Focus by Faith";
    private const string ReportsFolder = "reports/monthly";
    private const string FileNameFormat = "WTF-Monthly-Reports-{0:0000}-{1:00}.xlsx";
    private const string HeaderTimeZone = "X-TimeZone";
    private const string DefaultSchedulerTimeZone = "Asia/Manila";
    private const string CurrencyPrefix = "PHP ";

    public async Task<MonthlyReportWorkbookStatusDto> GenerateAsync(
        int year,
        int month,
        string? requestedTimeZoneId,
        CancellationToken cancellationToken)
    {
        ValidateMonth(year, month);
        var timeZone = RequestTimeZone.Resolve(
            string.IsNullOrWhiteSpace(requestedTimeZoneId) ? DefaultSchedulerTimeZone : requestedTimeZoneId);
        var fromDate = new DateTime(year, month, 1);
        var toDate = fromDate.AddMonths(1).AddDays(-1);

        return await GenerateForRangeAsync(
            year,
            month,
            timeZone,
            fromDate,
            toDate,
            cancellationToken);
    }

    public async Task<MonthlyReportWorkbookStatusDto> GenerateThroughDateAsync(
        int year,
        int month,
        DateTime throughDateLocal,
        string? requestedTimeZoneId,
        CancellationToken cancellationToken)
    {
        ValidateMonth(year, month);
        var timeZone = RequestTimeZone.Resolve(
            string.IsNullOrWhiteSpace(requestedTimeZoneId) ? DefaultSchedulerTimeZone : requestedTimeZoneId);
        var fromDate = new DateTime(year, month, 1);
        var toDate = throughDateLocal.Date;

        if (toDate < fromDate)
        {
            toDate = fromDate;
        }

        return await GenerateForRangeAsync(
            year,
            month,
            timeZone,
            fromDate,
            toDate,
            cancellationToken);
    }

    private async Task<MonthlyReportWorkbookStatusDto> GenerateForRangeAsync(
        int year,
        int month,
        TimeZoneInfo timeZone,
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken)
    {
        var dailyRows = await ExecuteWithTimeZoneAsync(
            timeZone.Id,
            () => sender.Send(
                new GetDailySalesReportQuery
                {
                    FromDate = fromDate,
                    ToDate = toDate,
                    GroupBy = ReportGroupByEnum.Day
                },
                cancellationToken));

        var productRows = await ExecuteWithTimeZoneAsync(
            timeZone.Id,
            () => sender.Send(
                new GetProductSalesReportQuery
                {
                    FromDate = fromDate,
                    ToDate = toDate
                },
                cancellationToken));

        var paymentRows = await ExecuteWithTimeZoneAsync(
            timeZone.Id,
            () => sender.Send(
                new GetPaymentsReportQuery
                {
                    FromDate = fromDate,
                    ToDate = toDate
                },
                cancellationToken));

        var hourlyRows = await ExecuteWithTimeZoneAsync(
            timeZone.Id,
            () => sender.Send(
                new GetHourlySalesReportQuery
                {
                    FromDate = fromDate,
                    ToDate = toDate
                },
                cancellationToken));

        var staffRows = await ExecuteWithTimeZoneAsync(
            timeZone.Id,
            () => sender.Send(
                new GetStaffPerformanceReportQuery
                {
                    FromDate = fromDate,
                    ToDate = toDate
                },
                cancellationToken));

        var generatedAtLocal = new DateTime(
            toDate.Year,
            toDate.Month,
            toDate.Day,
            23,
            59,
            0,
            DateTimeKind.Unspecified);
        var generatedAtUtc = new DateTimeOffset(
            TimeZoneInfo.ConvertTimeToUtc(generatedAtLocal, timeZone),
            TimeSpan.Zero);
        var generatedAtLabel = $"{generatedAtLocal.ToString("MMMM d, yyyy h:mm tt", CultureInfo.InvariantCulture)} {timeZone.Id}";
        var workbookBytes = BuildWorkbook(
            fromDate,
            toDate,
            generatedAtLabel,
            dailyRows,
            productRows,
            paymentRows,
            hourlyRows,
            staffRows);

        var fileName = BuildFileName(year, month);
        var relativePath = BuildRelativePath(year, month);
        await storage.SaveAsync(
            relativePath,
            workbookBytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            generatedAtUtc,
            cancellationToken);

        return await GetStatusAsync(year, month, cancellationToken);
    }

    public async Task<MonthlyReportWorkbookStatusDto> GetStatusAsync(
        int year,
        int month,
        CancellationToken cancellationToken)
    {
        ValidateMonth(year, month);
        var fileName = BuildFileName(year, month);
        var relativePath = BuildRelativePath(year, month);
        var fileInfo = await storage.GetInfoAsync(relativePath, cancellationToken);

        return new MonthlyReportWorkbookStatusDto(
            year,
            month,
            fileInfo is not null,
            fileName,
            fileInfo?.LastModifiedUtc.UtcDateTime,
            fileInfo?.SizeBytes);
    }

    public async Task<(byte[] Data, string FileName)?> GetFileAsync(
        int year,
        int month,
        CancellationToken cancellationToken)
    {
        ValidateMonth(year, month);
        var fileName = BuildFileName(year, month);
        var relativePath = BuildRelativePath(year, month);
        var bytes = await storage.ReadAllBytesAsync(relativePath, cancellationToken);
        if (bytes is null)
        {
            return null;
        }

        return (bytes, fileName);
    }

    private static void ValidateMonth(int year, int month)
    {
        if (year < 2000 || year > 2100)
        {
            throw new InvalidOperationException("Year must be between 2000 and 2100.");
        }

        if (month is < 1 or > 12)
        {
            throw new InvalidOperationException("Month must be between 1 and 12.");
        }
    }

    private async Task<T> ExecuteWithTimeZoneAsync<T>(
        string timeZoneId,
        Func<Task<T>> action)
    {
        var currentContext = httpContextAccessor.HttpContext;
        if (currentContext is null)
        {
            var scopedContext = new DefaultHttpContext();
            scopedContext.Request.Headers[HeaderTimeZone] = timeZoneId;
            httpContextAccessor.HttpContext = scopedContext;
            try
            {
                return await action();
            }
            finally
            {
                httpContextAccessor.HttpContext = null;
            }
        }

        var hasOriginalValue = currentContext.Request.Headers.TryGetValue(HeaderTimeZone, out var originalValue);
        currentContext.Request.Headers[HeaderTimeZone] = timeZoneId;
        try
        {
            return await action();
        }
        finally
        {
            if (hasOriginalValue)
            {
                currentContext.Request.Headers[HeaderTimeZone] = originalValue;
            }
            else
            {
                currentContext.Request.Headers.Remove(HeaderTimeZone);
            }
        }
    }

    private static byte[] BuildWorkbook(
        DateTime fromDate,
        DateTime toDate,
        string generatedAtLabel,
        IReadOnlyList<DailySalesReportRowDto> dailyRows,
        IReadOnlyList<ProductSalesReportRowDto> productRows,
        IReadOnlyList<PaymentsReportRowDto> paymentRows,
        IReadOnlyList<HourlySalesReportRowDto> hourlyRows,
        IReadOnlyList<StaffPerformanceReportRowDto> staffRows)
    {
        using var workbook = new XLWorkbook();

        AddSheet(
            workbook,
            "Daily Sales Summary",
            "Daily Sales Summary",
            fromDate,
            toDate,
            generatedAtLabel,
            ["Date", "Revenue", "Orders", "Avg/Order", "Tips", "Void/Cancelled"],
            dailyRows.Select(row => new[]
            {
                row.PeriodStart.ToString("MMM dd, yyyy", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalRevenue),
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.AverageOrderValue),
                FormatMoney(row.TipsTotal),
                row.VoidCancelledCount.ToString("N0", CultureInfo.InvariantCulture)
            }),
            BuildDailySalesSummary(dailyRows));

        AddSheet(
            workbook,
            "Product Sales Breakdown",
            "Product Sales Breakdown",
            fromDate,
            toDate,
            generatedAtLabel,
            ["Product", "Category", "Subcategory/Type", "Qty", "Revenue", "Revenue %"],
            productRows.Select(row => new[]
            {
                row.ProductName,
                row.CategoryName,
                string.IsNullOrWhiteSpace(row.SubCategoryName) ? "-" : row.SubCategoryName!,
                row.QuantitySold.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.Revenue),
                $"{row.RevenuePercent:N2}%"
            }),
            BuildProductSalesSummary(productRows));

        AddSheet(
            workbook,
            "Payment Method Breakdown",
            "Payment Method Breakdown",
            fromDate,
            toDate,
            generatedAtLabel,
            ["Payment Method", "Orders", "Amount", "Total %"],
            paymentRows.Select(row => new[]
            {
                row.PaymentMethod,
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalAmount),
                $"{row.TotalPercent:N2}%"
            }),
            BuildPaymentsSummary(paymentRows));

        AddSheet(
            workbook,
            "Hourly Sales Distribution",
            "Hourly Sales Distribution",
            fromDate,
            toDate,
            generatedAtLabel,
            ["Hour Range", "Orders", "Revenue"],
            hourlyRows.Select(row => new[]
            {
                $"{row.Hour:00}:00 - {((row.Hour + 1) % 24):00}:00",
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.Revenue)
            }),
            BuildHourlySalesSummary(hourlyRows));

        AddSheet(
            workbook,
            "Staff Performance",
            "Staff Performance",
            fromDate,
            toDate,
            generatedAtLabel,
            ["Staff", "Orders", "Revenue", "Avg/Order", "Tips"],
            staffRows.Select(row => new[]
            {
                row.StaffName,
                row.OrderCount.ToString("N0", CultureInfo.InvariantCulture),
                FormatMoney(row.TotalRevenue),
                FormatMoney(row.AverageOrderValue),
                FormatMoney(row.TipsReceived)
            }),
            BuildStaffPerformanceSummary(staffRows));

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void AddSheet(
        XLWorkbook workbook,
        string worksheetName,
        string reportTitle,
        DateTime fromDate,
        DateTime toDate,
        string generatedAtLabel,
        IReadOnlyList<string> headers,
        IEnumerable<IReadOnlyList<string>> rows,
        IReadOnlyList<WorksheetSummaryItem>? summaryItems = null)
    {
        var worksheet = workbook.Worksheets.Add(worksheetName);

        worksheet.Cell(1, 1).Value = CompanyName;
        worksheet.Cell(1, 1).Style.Font.Bold = true;
        worksheet.Cell(1, 1).Style.Font.FontSize = 16;
        worksheet.Cell(1, 1).Style.Font.FontColor = XLColor.Black;

        worksheet.Cell(2, 1).Value = reportTitle;
        worksheet.Cell(2, 1).Style.Font.Bold = true;
        worksheet.Cell(2, 1).Style.Font.FontSize = 14;
        worksheet.Cell(2, 1).Style.Font.FontColor = XLColor.Black;

        worksheet.Cell(3, 1).Value = $"Date Range: {fromDate:MMMM dd, yyyy} - {toDate:MMMM dd, yyyy}";
        worksheet.Cell(3, 1).Style.Font.FontSize = 10;
        worksheet.Cell(3, 1).Style.Font.FontColor = XLColor.FromHtml("#4B5563");

        worksheet.Cell(4, 1).Value = $"Generated: {generatedAtLabel}";
        worksheet.Cell(4, 1).Style.Font.FontSize = 10;
        worksheet.Cell(4, 1).Style.Font.FontColor = XLColor.FromHtml("#4B5563");

        var headerRow = 6;
        for (var index = 0; index < headers.Count; index++)
        {
            var cell = worksheet.Cell(headerRow, index + 1);
            cell.Value = headers[index];
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.Black;
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }

        var currentRow = headerRow + 1;
        foreach (var row in rows)
        {
            for (var columnIndex = 0; columnIndex < row.Count; columnIndex++)
            {
                worksheet.Cell(currentRow, columnIndex + 1).Value = row[columnIndex];
            }

            currentRow++;
        }

        if (currentRow > headerRow + 1)
        {
            worksheet.Range(headerRow, 1, currentRow - 1, headers.Count).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            worksheet.Range(headerRow, 1, currentRow - 1, headers.Count).Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        }

        if (summaryItems is { Count: > 0 })
        {
            currentRow++;
            worksheet.Cell(currentRow, 1).Value = "Summary";
            worksheet.Cell(currentRow, 1).Style.Font.Bold = true;
            worksheet.Cell(currentRow, 1).Style.Font.FontSize = 11;
            worksheet.Cell(currentRow, 1).Style.Font.FontColor = XLColor.FromHtml("#111827");
            currentRow++;

            foreach (var summaryItem in summaryItems)
            {
                var labelCell = worksheet.Cell(currentRow, 1);
                labelCell.Value = summaryItem.Label;
                labelCell.Style.Font.FontColor = XLColor.FromHtml("#374151");

                var valueCell = worksheet.Cell(currentRow, 2);
                valueCell.Value = summaryItem.Value;
                valueCell.Style.Font.Bold = true;
                valueCell.Style.Font.FontColor = XLColor.FromHtml("#111827");
                valueCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
                currentRow++;
            }
        }

        worksheet.Columns(1, headers.Count).AdjustToContents();
    }

    private static IReadOnlyList<WorksheetSummaryItem> BuildDailySalesSummary(
        IReadOnlyList<DailySalesReportRowDto> rows)
    {
        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalTips = rows.Sum(r => r.TipsTotal);
        var totalVoidCancelled = rows.Sum(r => r.VoidCancelledCount);
        var averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0m;

        return
        [
            new WorksheetSummaryItem("Total Revenue", FormatMoney(totalRevenue)),
            new WorksheetSummaryItem("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture)),
            new WorksheetSummaryItem("Average Order Value", FormatMoney(averageOrder)),
            new WorksheetSummaryItem("Total Tips", FormatMoney(totalTips)),
            new WorksheetSummaryItem("Void/Cancelled", totalVoidCancelled.ToString("N0", CultureInfo.InvariantCulture))
        ];
    }

    private static IReadOnlyList<WorksheetSummaryItem> BuildProductSalesSummary(
        IReadOnlyList<ProductSalesReportRowDto> rows)
    {
        var totalRevenue = rows.Sum(r => r.Revenue);
        var totalQuantity = rows.Sum(r => r.QuantitySold);

        return
        [
            new WorksheetSummaryItem("Total Revenue", FormatMoney(totalRevenue)),
            new WorksheetSummaryItem("Total Quantity", totalQuantity.ToString("N0", CultureInfo.InvariantCulture))
        ];
    }

    private static IReadOnlyList<WorksheetSummaryItem> BuildPaymentsSummary(
        IReadOnlyList<PaymentsReportRowDto> rows)
    {
        var totalAmount = rows.Sum(r => r.TotalAmount);
        var totalOrders = rows.Sum(r => r.OrderCount);

        return
        [
            new WorksheetSummaryItem("Total Amount", FormatMoney(totalAmount)),
            new WorksheetSummaryItem("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture))
        ];
    }

    private static IReadOnlyList<WorksheetSummaryItem> BuildHourlySalesSummary(
        IReadOnlyList<HourlySalesReportRowDto> rows)
    {
        var totalRevenue = rows.Sum(r => r.Revenue);
        var totalOrders = rows.Sum(r => r.OrderCount);

        return
        [
            new WorksheetSummaryItem("Total Revenue", FormatMoney(totalRevenue)),
            new WorksheetSummaryItem("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture))
        ];
    }

    private static IReadOnlyList<WorksheetSummaryItem> BuildStaffPerformanceSummary(
        IReadOnlyList<StaffPerformanceReportRowDto> rows)
    {
        var totalRevenue = rows.Sum(r => r.TotalRevenue);
        var totalOrders = rows.Sum(r => r.OrderCount);
        var totalTips = rows.Sum(r => r.TipsReceived);
        var averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0m;

        return
        [
            new WorksheetSummaryItem("Total Revenue", FormatMoney(totalRevenue)),
            new WorksheetSummaryItem("Total Orders", totalOrders.ToString("N0", CultureInfo.InvariantCulture)),
            new WorksheetSummaryItem("Average Order Value", FormatMoney(averageOrderValue)),
            new WorksheetSummaryItem("Total Tips", FormatMoney(totalTips))
        ];
    }

    private static string BuildFileName(int year, int month)
    {
        return string.Format(CultureInfo.InvariantCulture, FileNameFormat, year, month);
    }

    private static string BuildRelativePath(int year, int month)
    {
        var folder = $"{ReportsFolder}/{year:0000}-{month:00}";
        return $"{folder}/{BuildFileName(year, month)}";
    }

    private static string FormatMoney(decimal amount)
    {
        return $"{CurrencyPrefix}{amount.ToString("N2", CultureInfo.InvariantCulture)}";
    }
}
