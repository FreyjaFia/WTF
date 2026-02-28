using System.Globalization;
using System.Text;

namespace WTF.Api.Endpoints;

internal static class SimplePdfBuilder
{
    private const float PageWidth = 612f;
    private const float PageHeight = 792f;
    private const float Margin = 40f;
    private const float HeaderRuleY = 696f;
    private const float TableTopY = 672f;
    private const float TableBottomY = 102f;
    private const float HeaderRowHeight = 22f;
    private const float MinDataRowHeight = 20f;
    private const float CellLineHeight = 11f;
    private const float CellPaddingX = 4f;
    private const float CellPaddingTop = 5f;
    private const float SummaryReserveHeight = 96f;
    private const float HeaderFontSize = 9f;
    private const float BodyFontSize = 9f;
    private const float BrandingFontSize = 17f;
    private const float TitleFontSize = 13f;
    private const float SubtitleFontSize = 10f;

    private const string CompanyName = "Wake.Taste.Focus by Faith";
    private const string LogoFileRelativePath = "Assets/pdf-logo.jpg";

    // Brand and UI colors aligned to current Angular palette.
    private const float BrandGreenR = 0.016f; // #047857
    private const float BrandGreenG = 0.471f;
    private const float BrandGreenB = 0.341f;
    private const float TableHeaderBgR = 0.000f;
    private const float TableHeaderBgG = 0.000f;
    private const float TableHeaderBgB = 0.000f;
    private const float HeaderTextR = 1.000f;
    private const float HeaderTextG = 1.000f;
    private const float HeaderTextB = 1.000f;
    private const float StripeBgR = 0.980f;
    private const float StripeBgG = 0.980f;
    private const float StripeBgB = 0.980f;

    internal enum PdfTextAlign
    {
        Left,
        Right,
        Center
    }

    internal sealed record PdfTableColumn(string Header, float Width, PdfTextAlign Align = PdfTextAlign.Left);

    internal sealed record PdfSummaryItem(string Label, string Value);

    internal sealed record PdfTable(IReadOnlyList<PdfTableColumn> Columns, IReadOnlyList<IReadOnlyList<string>> Rows);

    internal sealed record PdfDocument(
        string Title,
        string Subtitle,
        PdfTable Table,
        IReadOnlyList<PdfSummaryItem> SummaryItems);

    private sealed record WrappedCell(IReadOnlyList<string> Lines);

    private sealed record WrappedRow(IReadOnlyList<WrappedCell> Cells, float Height);

    private sealed record PdfLogo(byte[] Bytes, int Width, int Height);

    public static byte[] Build(PdfDocument document)
    {
        var logo = TryLoadLogo();
        var wrappedRows = BuildWrappedRows(document.Table);
        var pageRows = PaginateRows(wrappedRows, document.SummaryItems.Count > 0);

        var hasLogo = logo is not null;
        var fontRegularObject = 3;
        var fontBoldObject = 4;
        var logoObject = hasLogo ? 5 : -1;
        var firstPageObject = hasLogo ? 6 : 5;
        var objectCount = (hasLogo ? 5 : 4) + (pageRows.Count * 2);

        var bytes = new MemoryStream();
        using var writer = new StreamWriter(bytes, Encoding.ASCII, leaveOpen: true) { NewLine = "\n" };

        writer.Write("%PDF-1.4\n");
        writer.Flush();

        var offsets = new int[objectCount + 1];

        WriteObject(writer, bytes, offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");

        var pageObjectNumbers = Enumerable.Range(0, pageRows.Count)
            .Select(i => firstPageObject + (i * 2))
            .ToArray();
        var kids = string.Join(' ', pageObjectNumbers.Select(n => $"{n} 0 R"));
        WriteObject(writer, bytes, offsets, 2, $"<< /Type /Pages /Kids [{kids}] /Count {pageRows.Count} >>");
        WriteObject(writer, bytes, offsets, fontRegularObject, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
        WriteObject(writer, bytes, offsets, fontBoldObject, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

        if (hasLogo && logoObject > 0)
        {
            offsets[logoObject] = (int)bytes.Position;
            writer.Write($"{logoObject} 0 obj\n");
            writer.Write($"<< /Type /XObject /Subtype /Image /Width {logo!.Width} /Height {logo.Height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {logo.Bytes.Length} >>\n");
            writer.Write("stream\n");
            writer.Flush();
            bytes.Write(logo.Bytes, 0, logo.Bytes.Length);
            writer.Write("\nendstream\nendobj\n");
            writer.Flush();
        }

        for (var i = 0; i < pageRows.Count; i++)
        {
            var pageObject = firstPageObject + (i * 2);
            var contentObject = pageObject + 1;
            var stream = BuildContentStream(
                document,
                pageRows[i],
                i + 1,
                pageRows.Count,
                i == pageRows.Count - 1,
                logo,
                hasLogo ? "Im1" : null);

            var xObjectResource = hasLogo ? $" /XObject << /Im1 {logoObject} 0 R >>" : string.Empty;
            WriteObject(
                writer,
                bytes,
                offsets,
                pageObject,
                $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {F(PageWidth)} {F(PageHeight)}] /Resources << /Font << /F1 {fontRegularObject} 0 R /F2 {fontBoldObject} 0 R >>{xObjectResource} >> /Contents {contentObject} 0 R >>");

            var streamBytes = Encoding.ASCII.GetBytes(stream);
            offsets[contentObject] = (int)bytes.Position;
            writer.Write($"{contentObject} 0 obj\n");
            writer.Write($"<< /Length {streamBytes.Length} >>\n");
            writer.Write("stream\n");
            writer.Flush();
            bytes.Write(streamBytes, 0, streamBytes.Length);
            writer.Write("\nendstream\nendobj\n");
            writer.Flush();
        }

        var xrefStart = (int)bytes.Position;
        writer.Write($"xref\n0 {objectCount + 1}\n");
        writer.Write("0000000000 65535 f \n");
        for (var i = 1; i <= objectCount; i++)
        {
            writer.Write($"{offsets[i]:D10} 00000 n \n");
        }

        writer.Write("trailer\n");
        writer.Write($"<< /Size {objectCount + 1} /Root 1 0 R >>\n");
        writer.Write("startxref\n");
        writer.Write($"{xrefStart}\n");
        writer.Write("%%EOF");
        writer.Flush();

        return bytes.ToArray();
    }

    private static IReadOnlyList<WrappedRow> BuildWrappedRows(PdfTable table)
    {
        var rows = new List<WrappedRow>(table.Rows.Count);
        foreach (var row in table.Rows)
        {
            var wrappedCells = new List<WrappedCell>(table.Columns.Count);
            var maxLines = 1;

            for (var i = 0; i < table.Columns.Count; i++)
            {
                var value = i < row.Count ? row[i] : string.Empty;
                var lines = WrapText(value, BodyFontSize, Math.Max(16f, table.Columns[i].Width - (CellPaddingX * 2f)));
                maxLines = Math.Max(maxLines, lines.Count);
                wrappedCells.Add(new WrappedCell(lines));
            }

            var height = Math.Max(MinDataRowHeight, (CellPaddingTop * 2f) + (maxLines * CellLineHeight));
            rows.Add(new WrappedRow(wrappedCells, height));
        }

        return rows;
    }

    private static List<IReadOnlyList<WrappedRow>> PaginateRows(IReadOnlyList<WrappedRow> rows, bool reserveSummaryOnLastPage)
    {
        var pages = new List<IReadOnlyList<WrappedRow>>();
        var fullPageCapacity = TableTopY - TableBottomY - HeaderRowHeight;
        var lastPageCapacity = reserveSummaryOnLastPage
            ? fullPageCapacity - SummaryReserveHeight
            : fullPageCapacity;

        var lastStart = rows.Count;
        var lastPageHeight = 0f;
        for (var i = rows.Count - 1; i >= 0; i--)
        {
            var next = rows[i].Height;
            if (lastStart == rows.Count || (lastPageHeight + next) <= lastPageCapacity)
            {
                lastStart = i;
                lastPageHeight += next;
                continue;
            }

            break;
        }

        if (rows.Count == 0)
        {
            pages.Add([]);
            return pages;
        }

        var cursor = 0;
        while (cursor < lastStart)
        {
            var chunk = new List<WrappedRow>();
            var used = 0f;
            while (cursor < lastStart)
            {
                var row = rows[cursor];
                if (chunk.Count > 0 && used + row.Height > fullPageCapacity)
                {
                    break;
                }

                chunk.Add(row);
                used += row.Height;
                cursor++;
            }

            pages.Add(chunk);
        }

        var lastChunk = rows.Skip(lastStart).ToList();
        pages.Add(lastChunk);

        return pages;
    }

    private static string BuildContentStream(
        PdfDocument document,
        IReadOnlyList<WrappedRow> rows,
        int pageNumber,
        int pageCount,
        bool isLastPage,
        PdfLogo? logo,
        string? logoResourceName)
    {
        var sb = new StringBuilder();
        var tableWidth = document.Table.Columns.Sum(c => c.Width);
        var tableLeft = Margin;
        var tableRight = tableLeft + tableWidth;

        DrawHeader(sb, document, pageNumber, pageCount, logo, logoResourceName);
        DrawLine(sb, Margin, HeaderRuleY, PageWidth - Margin, HeaderRuleY, 0.82f);

        var headerTop = TableTopY;
        var headerBottom = headerTop - HeaderRowHeight;
        var tableBottom = headerBottom - rows.Sum(r => r.Height);

        DrawFilledRect(sb, tableLeft, headerBottom, tableWidth, HeaderRowHeight, TableHeaderBgR, TableHeaderBgG, TableHeaderBgB);

        var cursorTop = headerBottom;
        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
        {
            var row = rows[rowIndex];
            var rowBottom = cursorTop - row.Height;
            if (rowIndex % 2 == 1)
            {
                DrawFilledRect(sb, tableLeft, rowBottom, tableWidth, row.Height, StripeBgR, StripeBgG, StripeBgB);
            }

            cursorTop = rowBottom;
        }

        DrawRect(sb, tableLeft, tableBottom, tableWidth, headerTop - tableBottom, 0.85f);
        DrawLine(sb, tableLeft, headerBottom, tableRight, headerBottom, 0.82f);

        cursorTop = headerBottom;
        foreach (var row in rows)
        {
            var rowBottom = cursorTop - row.Height;
            DrawLine(sb, tableLeft, rowBottom, tableRight, rowBottom, 0.90f);
            cursorTop = rowBottom;
        }

        var x = tableLeft;
        foreach (var column in document.Table.Columns)
        {
            DrawLine(sb, x, headerTop, x, tableBottom, 0.86f);
            x += column.Width;
        }

        DrawLine(sb, tableRight, headerTop, tableRight, tableBottom, 0.86f);

        x = tableLeft;
        foreach (var column in document.Table.Columns)
        {
            AddCellLine(
                sb,
                column.Header,
                HeaderFontSize,
                x,
                headerTop - 15f,
                column.Width,
                PdfTextAlign.Left,
                true,
                HeaderTextR,
                HeaderTextG,
                HeaderTextB);
            x += column.Width;
        }

        var rowTop = headerBottom;
        foreach (var row in rows)
        {
            x = tableLeft;
            for (var i = 0; i < document.Table.Columns.Count; i++)
            {
                var column = document.Table.Columns[i];
                var cell = row.Cells[i];
                for (var lineIndex = 0; lineIndex < cell.Lines.Count; lineIndex++)
                {
                    var y = rowTop - CellPaddingTop - 9f - (lineIndex * CellLineHeight);
                    AddCellLine(sb, cell.Lines[lineIndex], BodyFontSize, x, y, column.Width, column.Align);
                }

                x += column.Width;
            }

            rowTop -= row.Height;
        }

        if (isLastPage && document.SummaryItems.Count > 0)
        {
            var summaryStartY = Math.Max(TableBottomY - 10f, tableBottom - 30f);
            AddText(sb, "Summary", 11f, tableLeft, summaryStartY, isBold: true);

            for (var i = 0; i < document.SummaryItems.Count; i++)
            {
                var entry = document.SummaryItems[i];
                var y = summaryStartY - 18f - (i * 14f);
                AddText(sb, entry.Label, 9f, tableLeft + 2f, y);
                AddText(sb, entry.Value, 9f, tableLeft + 300f, y, align: PdfTextAlign.Right, isBold: true);
            }
        }

        return sb.ToString();
    }

    private static void DrawHeader(
        StringBuilder sb,
        PdfDocument document,
        int pageNumber,
        int pageCount,
        PdfLogo? logo,
        string? logoResourceName)
    {
        var logoX = Margin;
        var logoY = 730f;
        var logoWidth = 40f;
        var logoHeight = 40f;

        if (logo is not null && !string.IsNullOrWhiteSpace(logoResourceName))
        {
            var scale = Math.Min(logoWidth / logo.Width, logoHeight / logo.Height);
            var drawW = logo.Width * scale;
            var drawH = logo.Height * scale;
            var drawX = logoX + ((logoWidth - drawW) / 2f);
            var drawY = logoY + ((logoHeight - drawH) / 2f);
            DrawImage(sb, logoResourceName, drawX, drawY, drawW, drawH);
        }
        else
        {
            DrawFilledRect(sb, logoX, logoY, logoWidth, logoHeight, BrandGreenR, BrandGreenG, BrandGreenB);
            AddText(sb, "WTF", 10f, logoX + (logoWidth / 2f), logoY + 14f, isBold: true, align: PdfTextAlign.Center);
        }

        AddText(sb, CompanyName, BrandingFontSize, logoX + 50f, 751f, isBold: true);
        AddText(sb, document.Title, TitleFontSize, logoX, 716f, isBold: true);
        AddText(sb, document.Subtitle, SubtitleFontSize, logoX, 700f);

        var generatedAt = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss 'UTC'", CultureInfo.InvariantCulture);
        AddText(sb, $"Generated: {generatedAt}", 9f, PageWidth - Margin, 752f, align: PdfTextAlign.Right);
        AddText(sb, $"Page {pageNumber} of {pageCount}", 9f, PageWidth - Margin, 738f, align: PdfTextAlign.Right);
    }

    private static PdfLogo? TryLoadLogo()
    {
        try
        {
            var directPath = Path.Combine(AppContext.BaseDirectory, LogoFileRelativePath);
            if (File.Exists(directPath))
            {
                var bytes = File.ReadAllBytes(directPath);
                var (width, height) = GetJpegDimensions(bytes);
                return new PdfLogo(bytes, width, height);
            }
        }
        catch
        {
            // No-op. Fallback logo mark will be used.
        }

        return null;
    }

    private static (int Width, int Height) GetJpegDimensions(byte[] jpeg)
    {
        if (jpeg.Length < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8)
        {
            throw new InvalidDataException("Invalid JPEG header.");
        }

        var index = 2;
        while (index + 8 < jpeg.Length)
        {
            if (jpeg[index] != 0xFF)
            {
                index++;
                continue;
            }

            var marker = jpeg[index + 1];
            if (marker is 0xD8 or 0xD9)
            {
                index += 2;
                continue;
            }

            if (marker is >= 0xD0 and <= 0xD7)
            {
                index += 2;
                continue;
            }

            if (index + 3 >= jpeg.Length)
            {
                break;
            }

            var segmentLength = (jpeg[index + 2] << 8) | jpeg[index + 3];
            if (segmentLength < 2 || index + 1 + segmentLength >= jpeg.Length)
            {
                break;
            }

            if (marker is 0xC0 or 0xC1 or 0xC2 or 0xC3 or 0xC5 or 0xC6 or 0xC7 or 0xC9 or 0xCA or 0xCB or 0xCD or 0xCE or 0xCF)
            {
                var height = (jpeg[index + 5] << 8) | jpeg[index + 6];
                var width = (jpeg[index + 7] << 8) | jpeg[index + 8];
                return (width, height);
            }

            index += 2 + segmentLength;
        }

        throw new InvalidDataException("Unable to read JPEG dimensions.");
    }

    private static IReadOnlyList<string> WrapText(string value, float fontSize, float maxWidth)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [string.Empty];
        }

        var lines = new List<string>();
        var paragraphs = value.Replace("\r", string.Empty, StringComparison.Ordinal).Split('\n');
        foreach (var paragraph in paragraphs)
        {
            if (string.IsNullOrWhiteSpace(paragraph))
            {
                lines.Add(string.Empty);
                continue;
            }

            var words = paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var current = string.Empty;
            foreach (var word in words)
            {
                var candidate = string.IsNullOrEmpty(current) ? word : $"{current} {word}";
                if (EstimateTextWidth(candidate, fontSize) <= maxWidth)
                {
                    current = candidate;
                    continue;
                }

                if (!string.IsNullOrEmpty(current))
                {
                    lines.Add(current);
                    current = string.Empty;
                }

                if (EstimateTextWidth(word, fontSize) <= maxWidth)
                {
                    current = word;
                    continue;
                }

                var broken = BreakLongWord(word, fontSize, maxWidth);
                for (var i = 0; i < broken.Count - 1; i++)
                {
                    lines.Add(broken[i]);
                }

                current = broken[^1];
            }

            if (!string.IsNullOrEmpty(current))
            {
                lines.Add(current);
            }
        }

        return lines.Count == 0 ? [string.Empty] : lines;
    }

    private static List<string> BreakLongWord(string word, float fontSize, float maxWidth)
    {
        var parts = new List<string>();
        var current = string.Empty;
        foreach (var ch in word)
        {
            var candidate = current + ch;
            if (EstimateTextWidth(candidate, fontSize) <= maxWidth || string.IsNullOrEmpty(current))
            {
                current = candidate;
                continue;
            }

            parts.Add(current);
            current = ch.ToString();
        }

        if (!string.IsNullOrEmpty(current))
        {
            parts.Add(current);
        }

        return parts.Count == 0 ? [word] : parts;
    }

    private static void WriteObject(
        StreamWriter writer,
        MemoryStream bytes,
        int[] offsets,
        int objectNumber,
        string content)
    {
        offsets[objectNumber] = (int)bytes.Position;
        writer.Write($"{objectNumber} 0 obj\n");
        writer.Write(content);
        writer.Write("\nendobj\n");
        writer.Flush();
    }

    private static void AddCellLine(
        StringBuilder sb,
        string text,
        float fontSize,
        float cellX,
        float y,
        float cellWidth,
        PdfTextAlign align,
        bool isBold = false,
        float textRed = 0f,
        float textGreen = 0f,
        float textBlue = 0f)
    {
        var textX = cellX + CellPaddingX;
        if (align == PdfTextAlign.Right)
        {
            textX = cellX + cellWidth - CellPaddingX;
        }
        else if (align == PdfTextAlign.Center)
        {
            textX = cellX + (cellWidth / 2f);
        }

        AddText(sb, text, fontSize, textX, y, isBold, align, textRed, textGreen, textBlue);
    }

    private static void AddText(
        StringBuilder sb,
        string text,
        float fontSize,
        float x,
        float y,
        bool isBold = false,
        PdfTextAlign align = PdfTextAlign.Left,
        float textRed = 0f,
        float textGreen = 0f,
        float textBlue = 0f)
    {
        var escaped = EscapeText(text);
        var drawX = x;

        if (align == PdfTextAlign.Right)
        {
            drawX -= EstimateTextWidth(text, fontSize);
        }
        else if (align == PdfTextAlign.Center)
        {
            drawX -= EstimateTextWidth(text, fontSize) / 2f;
        }

        sb.Append("BT\n");
        sb.Append($"{F(textRed)} {F(textGreen)} {F(textBlue)} rg\n");
        sb.Append($"/{(isBold ? "F2" : "F1")} {F(fontSize)} Tf\n");
        sb.Append($"{F(drawX)} {F(y)} Td\n");
        sb.Append($"({escaped}) Tj\n");
        sb.Append("ET\n");
    }

    private static void DrawImage(StringBuilder sb, string imageName, float x, float y, float width, float height)
    {
        sb.Append("q\n");
        sb.Append($"{F(width)} 0 0 {F(height)} {F(x)} {F(y)} cm\n");
        sb.Append($"/{imageName} Do\n");
        sb.Append("Q\n");
    }

    private static void DrawFilledRect(
        StringBuilder sb,
        float x,
        float y,
        float width,
        float height,
        float red,
        float green,
        float blue)
    {
        sb.Append($"{F(red)} {F(green)} {F(blue)} rg\n");
        sb.Append($"{F(x)} {F(y)} {F(width)} {F(height)} re f\n");
        sb.Append("0 0 0 rg\n");
    }

    private static void DrawRect(StringBuilder sb, float x, float y, float width, float height, float gray)
    {
        sb.Append($"{F(gray)} G\n");
        sb.Append("0.7 w\n");
        sb.Append($"{F(x)} {F(y)} {F(width)} {F(height)} re S\n");
        sb.Append("0 G\n");
    }

    private static void DrawLine(StringBuilder sb, float x1, float y1, float x2, float y2, float gray)
    {
        sb.Append($"{F(gray)} G\n");
        sb.Append("0.5 w\n");
        sb.Append($"{F(x1)} {F(y1)} m {F(x2)} {F(y2)} l S\n");
        sb.Append("0 G\n");
    }

    private static string EscapeText(string value)
    {
        return value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("(", "\\(", StringComparison.Ordinal)
            .Replace(")", "\\)", StringComparison.Ordinal);
    }

    private static float EstimateTextWidth(string value, float fontSize)
    {
        return value.Length * fontSize * 0.5f;
    }

    private static string F(float value)
    {
        return value.ToString("0.###", CultureInfo.InvariantCulture);
    }
}
