using System.Globalization;
using System.Text.Json;
using MediatR;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit;
using WTF.Api.Features.Audit.DTOs;
using WTF.Api.Features.Audit.Enums;

namespace WTF.Api.Endpoints;

public static class AuditEndpoints
{
    private const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string PdfContentType = "application/pdf";

    public static IEndpointRouteBuilder MapAudit(this IEndpointRouteBuilder app)
    {
        var auditGroup = app.MapGroup("/api/audit-logs")
            .RequireAuthorization(AppPolicies.AuditRead);

        // Returns JSON by default; an Accept header for Excel or PDF returns the same
        // (filtered) logs as a file, like the report endpoints.
        auditGroup.MapGet("/",
            async (HttpContext httpContext, [AsParameters] GetAuditLogsQuery query, ISender sender) =>
            {
                var result = await sender.Send(query);
                return BuildAuditLogResponse(httpContext, query, result);
            });

        // The actions that can appear in the log, for the action filter.
        auditGroup.MapGet("/actions",
            () => Results.Ok(Enum.GetNames<AuditAction>().Order().ToArray()));

        return app;
    }

    private static IResult BuildAuditLogResponse(
        HttpContext httpContext,
        GetAuditLogsQuery query,
        PagedResultDto<AuditLogDto> result)
    {
        var accepts = httpContext.Request.Headers.Accept.ToString();
        var wantsExcel = accepts.Contains(ExcelContentType, StringComparison.OrdinalIgnoreCase)
            || accepts.Contains("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase);
        var wantsPdf = accepts.Contains(PdfContentType, StringComparison.OrdinalIgnoreCase);

        if (!wantsExcel && !wantsPdf)
        {
            return Results.Ok(result);
        }

        var timeZone = ExportFormatting.ResolveTimeZone(httpContext);
        var generatedAtLabel = ExportFormatting.BuildGeneratedAtLabel(httpContext);

        try
        {
            if (wantsExcel)
            {
                var document = BuildExcelDocument(result.Items, query, timeZone) with { GeneratedAtLabel = generatedAtLabel };
                return Results.File(
                    SimpleExcelBuilder.Build(document),
                    ExcelContentType,
                    BuildExportFileName(query, timeZone, "xlsx"));
            }

            var pdfDocument = BuildPdfDocument(result.Items, query, timeZone) with { GeneratedAtLabel = generatedAtLabel };
            return Results.File(
                SimplePdfBuilder.Build(pdfDocument),
                PdfContentType,
                BuildExportFileName(query, timeZone, "pdf"));
        }
        catch (Exception ex)
        {
            return Results.Problem(
                title: wantsExcel ? "Excel export failed" : "PDF export failed",
                detail: ex.Message,
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static SimpleExcelBuilder.ExcelDocument BuildExcelDocument(
        IReadOnlyList<AuditLogDto> rows,
        GetAuditLogsQuery query,
        TimeZoneInfo timeZone)
    {
        var columns = new List<SimpleExcelBuilder.ExcelTableColumn>
        {
            new("Timestamp"),
            new("User"),
            new("Action"),
            new("Entity"),
            new("Entity ID"),
            new("IP Address"),
            new("Old Values"),
            new("New Values")
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                FormatTimestamp(row.Timestamp, timeZone),
                row.UserName ?? row.UserId.ToString(),
                row.Action,
                row.EntityType,
                row.EntityId,
                row.IpAddress ?? string.Empty,
                FormatValues(row.OldValues),
                FormatValues(row.NewValues)
            ]);
        }

        return new SimpleExcelBuilder.ExcelDocument(
            "Audit Logs",
            BuildDateRangeLabel(query, timeZone),
            columns,
            tableRows,
            BuildSummary(rows, query).Select(item => new SimpleExcelBuilder.ExcelSummaryItem(item.Label, item.Value)).ToList());
    }

    private static SimplePdfBuilder.PdfDocument BuildPdfDocument(
        IReadOnlyList<AuditLogDto> rows,
        GetAuditLogsQuery query,
        TimeZoneInfo timeZone)
    {
        var columns = new List<SimplePdfBuilder.PdfTableColumn>
        {
            new("Timestamp", 82f),
            new("User", 62f),
            new("Action", 80f),
            new("Entity", 68f),
            new("Old Values", 120f),
            new("New Values", 120f)
        };

        var tableRows = new List<IReadOnlyList<string>>(rows.Count);
        foreach (var row in rows)
        {
            tableRows.Add(
            [
                FormatTimestamp(row.Timestamp, timeZone),
                row.UserName ?? row.UserId.ToString(),
                row.Action,
                row.EntityType,
                FormatValues(row.OldValues),
                FormatValues(row.NewValues)
            ]);
        }

        return new SimplePdfBuilder.PdfDocument(
            "Audit Logs",
            BuildDateRangeLabel(query, timeZone),
            new SimplePdfBuilder.PdfTable(columns, tableRows),
            BuildSummary(rows, query).Select(item => new SimplePdfBuilder.PdfSummaryItem(item.Label, item.Value)).ToList());
    }

    /// <summary>Turns the stored JSON snapshot into one "Path: value" line per value, nested objects and arrays included.</summary>
    private static string FormatValues(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return string.Empty;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
            {
                return json;
            }

            var lines = new List<string>();
            FlattenValue(document.RootElement, string.Empty, lines);
            return string.Join("\n", lines);
        }
        catch (JsonException)
        {
            return json;
        }
    }

    private static void FlattenValue(JsonElement value, string path, List<string> lines)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                var hasProperties = false;
                foreach (var property in value.EnumerateObject())
                {
                    hasProperties = true;
                    FlattenValue(property.Value, path.Length == 0 ? property.Name : $"{path}.{property.Name}", lines);
                }

                if (!hasProperties && path.Length > 0)
                {
                    lines.Add($"{path}: {{}}");
                }

                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in value.EnumerateArray())
                {
                    FlattenValue(item, $"{path}[{index++}]", lines);
                }

                if (index == 0 && path.Length > 0)
                {
                    lines.Add($"{path}: []");
                }

                break;
            default:
                var text = value.ValueKind switch
                {
                    JsonValueKind.String => value.GetString() ?? string.Empty,
                    JsonValueKind.Null => "-",
                    _ => value.GetRawText()
                };
                lines.Add(path.Length == 0 ? text : $"{path}: {text}");
                break;
        }
    }

    private static IReadOnlyList<(string Label, string Value)> BuildSummary(
        IReadOnlyList<AuditLogDto> rows,
        GetAuditLogsQuery query)
    {
        var actions = query.GetActions();

        return
        [
            ("Total Records", rows.Count.ToString("N0", CultureInfo.InvariantCulture)),
            ("Actions", actions.Count == 0 ? "All actions" : string.Join(", ", actions))
        ];
    }

    private static string FormatTimestamp(DateTime utcTimestamp, TimeZoneInfo timeZone)
    {
        return ToLocal(utcTimestamp, timeZone).ToString("MMM d, yyyy h:mm tt", CultureInfo.InvariantCulture);
    }

    private static DateTime ToLocal(DateTime utcValue, TimeZoneInfo timeZone)
    {
        return TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcValue, DateTimeKind.Utc), timeZone);
    }

    private static string BuildDateRangeLabel(GetAuditLogsQuery query, TimeZoneInfo timeZone)
    {
        string? from = query.FromDate.HasValue
            ? ToLocal(query.FromDate.Value, timeZone).ToString("MMMM dd, yyyy", CultureInfo.InvariantCulture)
            : null;
        string? to = query.ToDate.HasValue
            ? ToLocal(query.ToDate.Value, timeZone).ToString("MMMM dd, yyyy", CultureInfo.InvariantCulture)
            : null;

        if (from is null && to is null)
        {
            return "Date Range: All dates";
        }

        if (from is not null && to is not null)
        {
            return $"Date Range: {from} - {to}";
        }

        return from is not null ? $"Date Range: From {from}" : $"Date Range: Until {to}";
    }

    private static string BuildExportFileName(GetAuditLogsQuery query, TimeZoneInfo timeZone, string extension)
    {
        if (query.FromDate.HasValue && query.ToDate.HasValue)
        {
            var from = ToLocal(query.FromDate.Value, timeZone);
            var to = ToLocal(query.ToDate.Value, timeZone);
            return $"WTF-Audit-Logs-{from:yyyyMMdd}-{to:yyyyMMdd}.{extension}";
        }

        var today = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone);
        return $"WTF-Audit-Logs-{today:yyyyMMdd}.{extension}";
    }
}
