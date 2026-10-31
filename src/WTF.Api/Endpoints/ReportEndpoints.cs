using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.Enums;

namespace WTF.Api.Endpoints;

public static class ReportEndpoints
{
    private const int MaxRangeDays = 366;
    private const int MaxExportRows = 50_000;

    public static IEndpointRouteBuilder MapReports(this IEndpointRouteBuilder app)
    {
        var reportsGroup = app.MapGroup("/api/reports")
            .RequireAuthorization(AppPolicies.ReportsRead);

        reportsGroup.MapGet("/daily-sales",
            async (HttpContext httpContext, [AsParameters] GetDailySalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var groupBy = query.GroupBy ?? ReportGroupByEnum.Day;
                if (!Enum.IsDefined(groupBy))
                {
                    return Results.BadRequest($"groupBy must be one of: {nameof(ReportGroupByEnum.Day)}, {nameof(ReportGroupByEnum.Week)}, {nameof(ReportGroupByEnum.Month)}.");
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.DailySales(groupBy), query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/product-sales",
            async (HttpContext httpContext, [AsParameters] GetProductSalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.ProductSales, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/product-margin",
            async (HttpContext httpContext, [AsParameters] GetProductMarginReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.ProductMargin, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/payments",
            async (HttpContext httpContext, [AsParameters] GetPaymentsReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Payments, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/hourly",
            async (HttpContext httpContext, [AsParameters] GetHourlySalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Hourly, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/staff",
            async (HttpContext httpContext, [AsParameters] GetStaffPerformanceReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Staff, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/category-sales",
            async (HttpContext httpContext, [AsParameters] GetCategorySalesReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.CategorySales, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/daily-close",
            async (HttpContext httpContext, [AsParameters] GetDailyCloseReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.DailyClose, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/voids",
            async (HttpContext httpContext, [AsParameters] GetVoidedOrdersReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Voids, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/promotions",
            async (HttpContext httpContext, [AsParameters] GetPromotionPerformanceReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Promotions, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/customer-links",
            async (HttpContext httpContext, [AsParameters] GetCustomerLinkReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, null);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.CustomerLinks, query.FromDate!.Value, query.ToDate!.Value, OrderSourceEnum.CustomerLink);
            });

        reportsGroup.MapGet("/customers",
            async (HttpContext httpContext, [AsParameters] GetCustomersReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateReportFilters(query.FromDate, query.ToDate, query.Source);
                if (validationResult != null)
                {
                    return validationResult;
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Customers, query.FromDate!.Value, query.ToDate!.Value, query.Source);
            });

        reportsGroup.MapGet("/stock-status",
            async (HttpContext httpContext, ISender sender) =>
            {
                var result = await sender.Send(new GetStockStatusReportQuery());
                return BuildReportResponse(httpContext, result, ReportTables.StockStatus, "Current stock levels", DateTime.UtcNow.ToString("yyyyMMdd"));
            });

        reportsGroup.MapGet("/waste",
            async (HttpContext httpContext, [AsParameters] GetWasteReportQuery query, ISender sender) =>
            {
                var validationResult = ValidateDateRange(query.FromDate, query.ToDate);
                if (validationResult != null)
                {
                    return validationResult;
                }

                if (!GetWasteReportHandler.IsValidGroupBy(query.GroupBy))
                {
                    return Results.BadRequest(new { message = "groupBy must be item, reason, staff or day." });
                }

                var result = await sender.Send(query);
                return BuildReportResponse(httpContext, result, ReportTables.Waste, query.FromDate!.Value, query.ToDate!.Value, null);
            });
        reportsGroup.MapGet("/monthly-workbook/status",
            async ([AsParameters] MonthlyWorkbookRequest request, IMonthlyReportWorkbookService workbookService, CancellationToken cancellationToken) =>
            {
                var validation = ValidateMonthRequest(request.Year, request.Month, request.Source);
                if (validation is not null)
                {
                    return validation;
                }

                var status = await workbookService.GetStatusAsync(
                    request.Year,
                    request.Month,
                    cancellationToken,
                    request.Source);

                return Results.Ok(status);
            });

        reportsGroup.MapPost("/monthly-workbook/generate",
            async (HttpContext httpContext, [AsParameters] MonthlyWorkbookRequest request, IMonthlyReportWorkbookService workbookService, CancellationToken cancellationToken) =>
            {
                var validation = ValidateMonthRequest(request.Year, request.Month, request.Source);
                if (validation is not null)
                {
                    return validation;
                }

                var requestedTimeZone = httpContext.Request.Headers["X-TimeZone"].ToString();
                var status = await workbookService.GenerateAsync(
                    request.Year,
                    request.Month,
                    requestedTimeZone,
                    cancellationToken,
                    request.Source);

                return Results.Ok(status);
            })
            .RequireAuthorization(AppPolicies.ReportsGenerate);

        reportsGroup.MapGet("/monthly-workbook/download",
            async ([AsParameters] MonthlyWorkbookRequest request, IMonthlyReportWorkbookService workbookService, CancellationToken cancellationToken) =>
            {
                var validation = ValidateMonthRequest(request.Year, request.Month, request.Source);
                if (validation is not null)
                {
                    return validation;
                }

                var file = await workbookService.GetFileAsync(
                    request.Year,
                    request.Month,
                    cancellationToken,
                    request.Source);

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

    private static IResult? ValidateDateRange(DateTime? fromDate, DateTime? toDate)
    {
        if (fromDate is null || toDate is null || fromDate == default(DateTime) || toDate == default(DateTime))
        {
            return Results.BadRequest("fromDate and toDate are required.");
        }

        if (toDate.Value.Date < fromDate.Value.Date)
        {
            return Results.BadRequest("toDate must be greater than or equal to fromDate.");
        }

        if ((toDate.Value.Date - fromDate.Value.Date).TotalDays > MaxRangeDays)
        {
            return Results.BadRequest($"The date range cannot be longer than {MaxRangeDays} days.");
        }

        return null;
    }

    private static IResult? ValidateMonthRequest(int year, int month, OrderSourceEnum? source)
    {
        if (year < 2000 || year > 2100)
        {
            return Results.BadRequest("year must be between 2000 and 2100.");
        }

        if (month is < 1 or > 12)
        {
            return Results.BadRequest("month must be between 1 and 12.");
        }

        if (source.HasValue && !Enum.IsDefined(source.Value))
        {
            return Results.BadRequest("source must be Pos or CustomerLink.");
        }

        return null;
    }

    private static IResult BuildReportResponse<T>(
        HttpContext httpContext,
        IReadOnlyList<T> rows,
        ReportTable<T> table,
        DateTime fromDate,
        DateTime toDate,
        OrderSourceEnum? source) =>
        BuildReportResponse(
            httpContext,
            rows,
            table,
            BuildDateRangeSubtitle(fromDate, toDate, source),
            $"{fromDate:yyyyMMdd}-{toDate:yyyyMMdd}");

    private static IResult BuildReportResponse<T>(
        HttpContext httpContext,
        IReadOnlyList<T> rows,
        ReportTable<T> table,
        string subtitle,
        string fileSuffix)
    {
        var accepts = httpContext.Request.Headers.Accept.ToString();
        var wantsExcel = accepts.Contains("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", StringComparison.OrdinalIgnoreCase)
            || accepts.Contains("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase);
        var wantsPdf = !wantsExcel && accepts.Contains("application/pdf", StringComparison.OrdinalIgnoreCase);

        if (!wantsExcel && !wantsPdf)
        {
            return Results.Ok(rows);
        }

        if (rows.Count > MaxExportRows)
        {
            return Results.BadRequest($"This report has more than {MaxExportRows:N0} rows. Narrow the date range or filters before exporting.");
        }

        // Exports follow what the screen shows: the same search and sort, and totals over the rows that remain.
        var query = httpContext.Request.Query;
        var sortDescending = string.Equals(query["sortDir"].ToString(), "desc", StringComparison.OrdinalIgnoreCase);
        var shown = table.Apply(rows, query["search"].ToString(), query["sortBy"].ToString(), sortDescending);
        var searchTerm = ReportTable<T>.SanitizeSearch(query["search"].ToString());
        if (searchTerm.Length > 0)
        {
            subtitle += $" | Search: {searchTerm}";
        }

        var generatedAtLabel = ExportFormatting.BuildGeneratedAtLabel(httpContext);

        if (wantsExcel)
        {
            try
            {
                var bytes = SimpleExcelBuilder.Build(table.ToExcel(shown, subtitle) with { GeneratedAtLabel = generatedAtLabel });
                return Results.File(
                    bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    BuildExportFileName(table.Title, fileSuffix, "xlsx"));
            }
            catch (Exception ex)
            {
                LogExportFailure(httpContext, ex);
                return Results.Problem(
                    title: "Excel export failed",
                    detail: "The file could not be created.",
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }

        try
        {
            var pdfBytes = SimplePdfBuilder.Build(table.ToPdf(shown, subtitle) with { GeneratedAtLabel = generatedAtLabel });
            return Results.File(pdfBytes, "application/pdf", BuildExportFileName(table.Title, fileSuffix, "pdf"));
        }
        catch (Exception ex)
        {
            LogExportFailure(httpContext, ex);
            return Results.Problem(
                title: "PDF export failed",
                detail: "The file could not be created.",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static void LogExportFailure(HttpContext httpContext, Exception exception) =>
        httpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("WTF.Api.Reports")
            .LogError(exception, "A report export failed.");

    private static string BuildDateRangeSubtitle(DateTime fromDate, DateTime toDate, OrderSourceEnum? source = null)
    {
        var range = $"Date Range: {fromDate:MMMM dd, yyyy} - {toDate:MMMM dd, yyyy}";
        return source.HasValue ? $"{range} | Source: {SourceLabel(source.Value)}" : range;
    }

    private static string SourceLabel(OrderSourceEnum source) =>
        source == OrderSourceEnum.CustomerLink ? "Customer link orders" : "Shop orders";

    private static IResult? ValidateReportFilters(DateTime? fromDate, DateTime? toDate, OrderSourceEnum? source)
    {
        var dateError = ValidateDateRange(fromDate, toDate);
        if (dateError != null)
        {
            return dateError;
        }

        if (source.HasValue && !Enum.IsDefined(source.Value))
        {
            return Results.BadRequest("source must be Pos or CustomerLink.");
        }

        return null;
    }

    private static string BuildExportFileName(
        string reportName,
        string fileSuffix,
        string extension)
    {
        var normalizedReportName = string.Join(
            '-',
            reportName
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => new string(part.Where(ch => char.IsLetterOrDigit(ch) || ch == '-').ToArray())));

        return $"WTF-{normalizedReportName}-{fileSuffix}.{extension}";
    }

    private sealed record MonthlyWorkbookRequest
    {
        public int Year { get; init; }

        public int Month { get; init; }

        public OrderSourceEnum? Source { get; init; }
    }
}
