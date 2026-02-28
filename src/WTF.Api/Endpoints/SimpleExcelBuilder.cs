using ClosedXML.Excel;
using System.Globalization;

namespace WTF.Api.Endpoints;

internal static class SimpleExcelBuilder
{
    private const string CompanyName = "Wake.Taste.Focus by Faith";

    internal enum ExcelTextAlign
    {
        Left,
        Right,
        Center
    }

    internal sealed record ExcelTableColumn(string Header, ExcelTextAlign Align = ExcelTextAlign.Left);

    internal sealed record ExcelSummaryItem(string Label, string Value);

    internal sealed record ExcelDocument(
        string Title,
        string Subtitle,
        IReadOnlyList<ExcelTableColumn> Columns,
        IReadOnlyList<IReadOnlyList<string>> Rows,
        IReadOnlyList<ExcelSummaryItem> SummaryItems,
        string? GeneratedAtLabel = null);

    public static byte[] Build(ExcelDocument document)
    {
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("Report");

        var row = 1;
        worksheet.Cell(row, 1).Value = CompanyName;
        worksheet.Cell(row, 1).Style.Font.Bold = true;
        worksheet.Cell(row, 1).Style.Font.FontSize = 16;
        worksheet.Cell(row, 1).Style.Font.FontColor = XLColor.Black;
        row++;

        worksheet.Cell(row, 1).Value = document.Title;
        worksheet.Cell(row, 1).Style.Font.Bold = true;
        worksheet.Cell(row, 1).Style.Font.FontSize = 14;
        worksheet.Cell(row, 1).Style.Font.FontColor = XLColor.Black;
        row++;

        worksheet.Cell(row, 1).Value = document.Subtitle;
        worksheet.Cell(row, 1).Style.Font.FontSize = 10;
        worksheet.Cell(row, 1).Style.Font.FontColor = XLColor.FromHtml("#4B5563");
        row++;

        var generatedCell = worksheet.Cell(row, 1);
        generatedCell.Value = document.GeneratedAtLabel
            ?? $"Generated: {DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss 'UTC'", CultureInfo.InvariantCulture)}";
        generatedCell.Style.Font.FontSize = 10;
        generatedCell.Style.Font.FontColor = XLColor.FromHtml("#4B5563");
        row += 2;

        var headerRow = row;
        for (var i = 0; i < document.Columns.Count; i++)
        {
            var cell = worksheet.Cell(headerRow, i + 1);
            cell.Value = document.Columns[i].Header;
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.Black;
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            cell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#111827");
            cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        }

        row++;
        for (var rowIndex = 0; rowIndex < document.Rows.Count; rowIndex++)
        {
            var rowValues = document.Rows[rowIndex];
            for (var colIndex = 0; colIndex < document.Columns.Count; colIndex++)
            {
                var value = colIndex < rowValues.Count ? rowValues[colIndex] : string.Empty;
                var cell = worksheet.Cell(row, colIndex + 1);
                cell.Value = value;
                cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                cell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#D1D5DB");
                cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

                if (rowIndex % 2 == 1)
                {
                    cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F9FAFB");
                }

                var align = document.Columns[colIndex].Align;
                cell.Style.Alignment.Horizontal = align switch
                {
                    ExcelTextAlign.Right => XLAlignmentHorizontalValues.Right,
                    ExcelTextAlign.Center => XLAlignmentHorizontalValues.Center,
                    _ => XLAlignmentHorizontalValues.Left
                };
            }

            row++;
        }

        if (document.SummaryItems.Count > 0)
        {
            row++;
            worksheet.Cell(row, 1).Value = "Summary";
            worksheet.Cell(row, 1).Style.Font.Bold = true;
            worksheet.Cell(row, 1).Style.Font.FontSize = 11;
            worksheet.Cell(row, 1).Style.Font.FontColor = XLColor.FromHtml("#111827");
            row++;

            foreach (var summaryItem in document.SummaryItems)
            {
                var labelCell = worksheet.Cell(row, 1);
                labelCell.Value = summaryItem.Label;
                labelCell.Style.Font.FontColor = XLColor.FromHtml("#374151");

                var valueCell = worksheet.Cell(row, 2);
                valueCell.Value = summaryItem.Value;
                valueCell.Style.Font.Bold = true;
                valueCell.Style.Font.FontColor = XLColor.FromHtml("#111827");
                valueCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
                row++;
            }
        }

        worksheet.Columns().AdjustToContents();
        worksheet.SheetView.FreezeRows(headerRow);

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
