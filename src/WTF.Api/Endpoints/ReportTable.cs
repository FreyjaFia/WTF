using System.Globalization;

namespace WTF.Api.Endpoints;

internal sealed record ReportColumn<T>(
    string Key,
    string Header,
    Func<T, string> Text,
    Func<T, IComparable?> SortValue,
    bool RightAligned = false,
    float Weight = 1f,
    Func<IReadOnlyList<T>, string>? Total = null);

internal sealed record ReportTable<T>(
    string Title,
    IReadOnlyList<ReportColumn<T>> Columns,
    Func<IReadOnlyList<T>, IReadOnlyList<(string Label, string Value)>> Summary)
{
    private const float PdfTableWidth = 532f;
    private const int MaxSearchLength = 100;
    private const int MaxPdfColumnChars = 24;

    // The portrait page fits about 7 columns; these low-value columns stay in Excel, CSV and the screen but not the PDF.
    private static readonly Dictionary<string, string[]> PdfOmittedColumns = new()
    {
        ["Daily Sales Summary"] = ["averageOrderValue", "voidCancelledCount"],
        ["Product Sales Breakdown"] = ["subCategoryName", "revenuePercent"],
        ["Staff Performance"] = ["averageOrderValue"],
        ["Voids and Refunds"] = ["orderedAt", "voidedBy", "staffVoidRate"],
        ["Customer Link Orders"] = ["awaitingCount", "pickupCount", "deliveryCount", "averageMinutesToReady"]
    };

    public static string SanitizeSearch(string? search)
    {
        var cleaned = new string((search ?? string.Empty).Where(c => !char.IsControl(c)).ToArray()).Trim();
        return cleaned.Length > MaxSearchLength ? cleaned[..MaxSearchLength] : cleaned;
    }

    public IReadOnlyList<T> Apply(IReadOnlyList<T> rows, string? search, string? sortKey, bool descending)
    {
        IEnumerable<T> result = rows;

        var term = SanitizeSearch(search);
        if (term.Length > 0)
        {
            result = result.Where(row => Columns.Any(column =>
                column.Text(row).Contains(term, StringComparison.OrdinalIgnoreCase)));
        }

        var sortColumn = Columns.FirstOrDefault(column =>
            string.Equals(column.Key, sortKey, StringComparison.OrdinalIgnoreCase));
        if (sortColumn is not null)
        {
            result = descending
                ? result.OrderByDescending(sortColumn.SortValue, ReportValueComparer.Instance)
                : result.OrderBy(sortColumn.SortValue, ReportValueComparer.Instance);
        }

        return result.ToList();
    }

    public bool HasTotalRow => Columns.Any(c => c.Total is not null);

    public IReadOnlyList<IReadOnlyList<string>> BuildRows(IReadOnlyList<T> rows)
    {
        var result = rows
            .Select(row => (IReadOnlyList<string>)Columns.Select(c => c.Text(row)).ToList())
            .ToList();

        if (HasTotalRow && rows.Count > 0)
        {
            result.Add(Columns.Select((c, index) => c.Total is not null ? c.Total(rows) : index == 0 ? "Total" : string.Empty).ToList());
        }

        return result;
    }

    public SimpleExcelBuilder.ExcelDocument ToExcel(IReadOnlyList<T> rows, string subtitle) =>
        new(
            Title,
            subtitle,
            Columns
                .Select(c => new SimpleExcelBuilder.ExcelTableColumn(
                    c.Header,
                    c.RightAligned ? SimpleExcelBuilder.ExcelTextAlign.Right : SimpleExcelBuilder.ExcelTextAlign.Left))
                .ToList(),
            BuildRows(rows),
            Summary(rows).Select(s => new SimpleExcelBuilder.ExcelSummaryItem(s.Label, s.Value)).ToList(),
            null,
            HasTotalRow && rows.Count > 0);

    public SimplePdfBuilder.PdfDocument ToPdf(IReadOnlyList<T> rows, string subtitle)
    {
        var omitted = PdfOmittedColumns.GetValueOrDefault(Title) ?? [];
        var kept = Enumerable.Range(0, Columns.Count).Where(index => !omitted.Contains(Columns[index].Key)).ToList();
        var tableRows = BuildRows(rows)
            .Select(row => (IReadOnlyList<string>)kept.Select(index => row[index]).ToList())
            .ToList();
        var pdfSourceColumns = kept.Select(index => Columns[index]).ToList();

        // Width follows the longest text in each column (long text is capped so it wraps), so amounts and headers do not wrap or collide.
        var lengths = pdfSourceColumns
            .Select((c, index) => Math.Clamp(Math.Max(c.Header.Length, tableRows.Count == 0 ? 0 : tableRows.Max(row => row[index].Length)), 4, MaxPdfColumnChars))
            .ToList();
        var totalLength = lengths.Sum();
        var pdfColumns = pdfSourceColumns
            .Select((c, index) => new SimplePdfBuilder.PdfTableColumn(
                c.Header,
                PdfTableWidth * lengths[index] / totalLength,
                c.RightAligned ? SimplePdfBuilder.PdfTextAlign.Right : SimplePdfBuilder.PdfTextAlign.Left))
            .ToList();

        return new SimplePdfBuilder.PdfDocument(
            Title,
            subtitle,
            new SimplePdfBuilder.PdfTable(pdfColumns, tableRows),
            Summary(rows).Select(s => new SimplePdfBuilder.PdfSummaryItem(s.Label, s.Value)).ToList());
    }
}

internal sealed class ReportValueComparer : IComparer<IComparable?>
{
    public static readonly ReportValueComparer Instance = new();

    public int Compare(IComparable? x, IComparable? y)
    {
        if (x is null || y is null)
        {
            return (x is null ? 0 : 1) - (y is null ? 0 : 1);
        }

        if (x is string xs && y is string ys)
        {
            return string.Compare(xs, ys, StringComparison.OrdinalIgnoreCase);
        }

        return x.CompareTo(y);
    }
}

internal static class ReportFormat
{
    public static string Money(decimal value) => $"PHP {value.ToString("N2", CultureInfo.InvariantCulture)}";

    public static string Number(int value) => value.ToString("N0", CultureInfo.InvariantCulture);

    public static string Percent(decimal value) => $"{value.ToString("N2", CultureInfo.InvariantCulture)}%";

    public static string Minutes(double? value) =>
        value is null ? "-" : $"{value.Value.ToString("N0", CultureInfo.InvariantCulture)} min";

    public static string Date(DateTime value) => value.ToString("MMM dd, yyyy h:mm tt", CultureInfo.InvariantCulture);
}
