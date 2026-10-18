using ClosedXML.Excel;
using MediatR;
using System.Globalization;
using WTF.Api.Common.Time;
using WTF.Api.Endpoints;
using WTF.Api.Features.Orders.Enums;
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
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null);

    Task<MonthlyReportWorkbookStatusDto> GenerateThroughDateAsync(
        int year,
        int month,
        DateTime throughDateLocal,
        string? requestedTimeZoneId,
        DateTime? generatedAtLocalOverride,
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null);

    Task<MonthlyReportWorkbookStatusDto> GetStatusAsync(
        int year,
        int month,
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null);

    Task<(byte[] Data, string FileName)?> GetFileAsync(
        int year,
        int month,
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null);
}

public sealed class MonthlyReportWorkbookService(
    ISender sender,
    IHttpContextAccessor httpContextAccessor,
    IReportFileStorage storage) : IMonthlyReportWorkbookService
{
    private sealed record WorksheetSummaryItem(string Label, string Value);

    private static readonly SemaphoreSlim GenerationLock = new(1, 1);

    private const string CompanyName = "Wake.Taste.Focus by Faith";
    private const string ReportsFolder = "reports/monthly";
    private const string FileNameFormat = "WTF-Monthly-Reports-{0:0000}-{1:00}.xlsx";
    private const string HeaderTimeZone = "X-TimeZone";
    private const string DefaultSchedulerTimeZone = "Asia/Manila";

    public async Task<MonthlyReportWorkbookStatusDto> GenerateAsync(
        int year,
        int month,
        string? requestedTimeZoneId,
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null)
    {
        ValidateMonth(year, month);
        var timeZone = RequestTimeZone.Resolve(
            string.IsNullOrWhiteSpace(requestedTimeZoneId) ? DefaultSchedulerTimeZone : requestedTimeZoneId);
        var fromDate = new DateTime(year, month, 1);
        var toDate = fromDate.AddMonths(1).AddDays(-1);

        if (!await GenerationLock.WaitAsync(0, cancellationToken))
        {
            throw new InvalidOperationException("A workbook is already being generated. Try again in a moment.");
        }

        try
        {
            return await GenerateForRangeAsync(
            year,
            month,
            timeZone,
            fromDate,
            toDate,
            null,
            cancellationToken,
            source);
        }
        finally
        {
            GenerationLock.Release();
        }
    }

    public async Task<MonthlyReportWorkbookStatusDto> GenerateThroughDateAsync(
        int year,
        int month,
        DateTime throughDateLocal,
        string? requestedTimeZoneId,
        DateTime? generatedAtLocalOverride,
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null)
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

        await GenerationLock.WaitAsync(cancellationToken);
        try
        {
            return await GenerateForRangeAsync(
            year,
            month,
            timeZone,
            fromDate,
            toDate,
            generatedAtLocalOverride,
            cancellationToken,
            source);
        }
        finally
        {
            GenerationLock.Release();
        }
    }

    private async Task<MonthlyReportWorkbookStatusDto> GenerateForRangeAsync(
        int year,
        int month,
        TimeZoneInfo timeZone,
        DateTime fromDate,
        DateTime toDate,
        DateTime? generatedAtLocalOverride,
        CancellationToken cancellationToken,
        OrderSourceEnum? source)
    {
        Task<List<T>> FetchAsync<T>(IRequest<List<T>> query) =>
            ExecuteWithTimeZoneAsync(timeZone.Id, () => sender.Send(query, cancellationToken));

        var dailyRows = await FetchAsync(new GetDailySalesReportQuery { FromDate = fromDate, ToDate = toDate, GroupBy = ReportGroupByEnum.Day, Source = source });
        var closeRows = await FetchAsync(new GetDailyCloseReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var categoryRows = await FetchAsync(new GetCategorySalesReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var productRows = await FetchAsync(new GetProductSalesReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var promotionRows = await FetchAsync(new GetPromotionPerformanceReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var paymentRows = await FetchAsync(new GetPaymentsReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var hourlyRows = await FetchAsync(new GetHourlySalesReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var staffRows = await FetchAsync(new GetStaffPerformanceReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var customerRows = await FetchAsync(new GetCustomersReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var linkRows = await FetchAsync(new GetCustomerLinkReportQuery { FromDate = fromDate, ToDate = toDate });
        var voidRows = await FetchAsync(new GetVoidedOrdersReportQuery { FromDate = fromDate, ToDate = toDate, Source = source });
        var stockRows = await FetchAsync(new GetStockStatusReportQuery());

        var generatedAtLocal = generatedAtLocalOverride
            ?? TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone);
        var generatedAtUtc = new DateTimeOffset(
            TimeZoneInfo.ConvertTimeToUtc(
                DateTime.SpecifyKind(generatedAtLocal, DateTimeKind.Unspecified),
                timeZone),
            TimeSpan.Zero);
        var generatedAtLabel = $"{generatedAtLocal.ToString("MMMM d, yyyy h:mm tt", CultureInfo.InvariantCulture)} {timeZone.Id}";
        using var workbook = new XLWorkbook();
        AddTableSheet(workbook, ReportTables.DailySales(ReportGroupByEnum.Day), dailyRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.DailyClose, closeRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.CategorySales, categoryRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.ProductSales, productRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.Promotions, promotionRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.Payments, paymentRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.Hourly, hourlyRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.Staff, staffRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.Customers, customerRows, fromDate, toDate, generatedAtLabel);
        if (source != OrderSourceEnum.Pos)
        {
            AddTableSheet(workbook, ReportTables.CustomerLinks, linkRows, fromDate, toDate, generatedAtLabel);
        }

        AddTableSheet(workbook, ReportTables.Voids, voidRows, fromDate, toDate, generatedAtLabel);
        AddTableSheet(workbook, ReportTables.StockStatus, stockRows, fromDate, toDate, generatedAtLabel, "Stock levels as of the time this workbook was generated");

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        var workbookBytes = stream.ToArray();

        var fileName = BuildFileName(year, month, source);
        var relativePath = BuildRelativePath(year, month, source);
        await storage.SaveAsync(
            relativePath,
            workbookBytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            generatedAtUtc,
            cancellationToken);

        return await GetStatusAsync(year, month, cancellationToken, source);
    }

    public async Task<MonthlyReportWorkbookStatusDto> GetStatusAsync(
        int year,
        int month,
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null)
    {
        ValidateMonth(year, month);
        var fileName = BuildFileName(year, month, source);
        var relativePath = BuildRelativePath(year, month, source);
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
        CancellationToken cancellationToken,
        OrderSourceEnum? source = null)
    {
        ValidateMonth(year, month);
        var fileName = BuildFileName(year, month, source);
        var relativePath = BuildRelativePath(year, month, source);
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

    private static void AddTableSheet<T>(
        XLWorkbook workbook,
        ReportTable<T> table,
        IReadOnlyList<T> rows,
        DateTime fromDate,
        DateTime toDate,
        string generatedAtLabel,
        string? subtitle = null) =>
        AddSheet(
            workbook,
            table.Title,
            table.Title,
            fromDate,
            toDate,
            generatedAtLabel,
            table.Columns.Select(column => column.Header).ToList(),
            table.BuildRows(rows),
            table.Summary(rows).Select(item => new WorksheetSummaryItem(item.Label, item.Value)).ToList(),
            subtitle,
            table.HasTotalRow && rows.Count > 0);

    private static void AddSheet(
        XLWorkbook workbook,
        string worksheetName,
        string reportTitle,
        DateTime fromDate,
        DateTime toDate,
        string generatedAtLabel,
        IReadOnlyList<string> headers,
        IEnumerable<IReadOnlyList<string>> rows,
        IReadOnlyList<WorksheetSummaryItem>? summaryItems = null,
        string? subtitle = null,
        bool hasTotalRow = false)
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

        worksheet.Cell(3, 1).Value = subtitle ?? $"Date Range: {fromDate:MMMM dd, yyyy} - {toDate:MMMM dd, yyyy}";
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
        var lastDataRow = 0;
        foreach (var row in rows)
        {
            for (var columnIndex = 0; columnIndex < row.Count; columnIndex++)
            {
                worksheet.Cell(currentRow, columnIndex + 1).Value = row[columnIndex];
            }

            lastDataRow = currentRow;

            currentRow++;
        }

        if (hasTotalRow && lastDataRow > headerRow)
        {
            var totalStyle = worksheet.Range(lastDataRow, 1, lastDataRow, headers.Count).Style;
            totalStyle.Font.Bold = true;
            totalStyle.Fill.BackgroundColor = XLColor.FromHtml("#E5E7EB");
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

    private static string BuildFileName(int year, int month, OrderSourceEnum? source)
    {
        var name = string.Format(CultureInfo.InvariantCulture, FileNameFormat, year, month);
        return source is null ? name : name.Replace(".xlsx", $"-{source}.xlsx", StringComparison.Ordinal);
    }

    private static string BuildRelativePath(int year, int month, OrderSourceEnum? source)
    {
        var folder = $"{ReportsFolder}/{year:0000}-{month:00}";
        return $"{folder}/{BuildFileName(year, month, source)}";
    }
}
