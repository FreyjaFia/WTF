using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using System.Text;
using WTF.Api.Endpoints;

namespace WTF.Tests.Endpoints;

public class ExportBuilderTests
{
    [Fact]
    public void Excel_Build_WritesHeadersRowsAndSummary()
    {
        var doc = new SimpleExcelBuilder.ExcelDocument(
            "Sales", "Jan 2025",
            [new("Name"), new("Amount", SimpleExcelBuilder.ExcelTextAlign.Right)],
            [["A", "1.00"], ["B"]],
            [new("Total", "1.00")],
            "Generated: test");

        var bytes = SimpleExcelBuilder.Build(doc);

        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var ws = wb.Worksheet("Report");
        ws.Cell(1, 1).GetString().ShouldBe("Wake.Taste.Focus by Faith");
        ws.Cell(2, 1).GetString().ShouldBe("Sales");
        ws.Cell(3, 1).GetString().ShouldBe("Jan 2025");
        ws.Cell(4, 1).GetString().ShouldBe("Generated: test");
        ws.Cell(6, 1).GetString().ShouldBe("Name");
        ws.Cell(6, 2).GetString().ShouldBe("Amount");
        ws.Cell(7, 1).GetString().ShouldBe("A");
        ws.Cell(7, 2).GetString().ShouldBe("1.00");
        ws.Cell(8, 2).GetString().ShouldBe(string.Empty);
        ws.Cell(7, 2).Style.Alignment.Horizontal.ShouldBe(XLAlignmentHorizontalValues.Right);
        ws.Cell(10, 1).GetString().ShouldBe("Summary");
        ws.Cell(11, 1).GetString().ShouldBe("Total");
        ws.Cell(11, 2).GetString().ShouldBe("1.00");
    }

    [Fact]
    public void Excel_Build_NoGeneratedLabel_UsesUtcDefault_AndNoSummaryWhenEmpty()
    {
        var doc = new SimpleExcelBuilder.ExcelDocument("T", "S", [new("H")], [["x"]], []);

        using var wb = new XLWorkbook(new MemoryStream(SimpleExcelBuilder.Build(doc)));
        var ws = wb.Worksheet("Report");
        ws.Cell(4, 1).GetString().ShouldStartWith("Generated: ");
        ws.Cell(4, 1).GetString().ShouldEndWith(" UTC");
        ws.Cell(9, 1).GetString().ShouldNotBe("Summary");
    }

    [Fact]
    public void Pdf_Build_ProducesWellFormedPdf()
    {
        var table = new SimplePdfBuilder.PdfTable(
            [new("Name", 200), new("Amt", 80, SimplePdfBuilder.PdfTextAlign.Right)],
            [["Alpha", "1.00"]]);
        var doc = new SimplePdfBuilder.PdfDocument("T", "S", table, [new("Total", "1.00")], "Generated: x");

        var text = Encoding.Latin1.GetString(SimplePdfBuilder.Build(doc));

        text.ShouldStartWith("%PDF-1.4");
        text.ShouldContain("/Count 1");
        text.TrimEnd().ShouldEndWith("%%EOF");
    }

    [Fact]
    public void Pdf_Build_ManyRows_PaginatesIntoMultiplePages()
    {
        var rows = Enumerable.Range(0, 200).Select(i => (IReadOnlyList<string>)[$"Row {i}"]).ToList();
        var table = new SimplePdfBuilder.PdfTable([new("Name", 200)], rows);
        var doc = new SimplePdfBuilder.PdfDocument("T", "S", table, []);

        var text = Encoding.Latin1.GetString(SimplePdfBuilder.Build(doc));

        text.ShouldNotContain("/Count 1 ");
    }

    [Fact]
    public void ExportFormatting_NoHeader_LabelsUtc()
    {
        var ctx = new DefaultHttpContext();

        ExportFormatting.ResolveTimeZone(ctx).ShouldBe(TimeZoneInfo.Utc);
        var label = ExportFormatting.BuildGeneratedAtLabel(ctx);
        label.ShouldStartWith("Generated: ");
        label.ShouldEndWith("UTC+00:00");
    }

    [Fact]
    public void ExportFormatting_WithHeader_IncludesZoneIdAndOffset()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-TimeZone"] = "Asia/Manila";

        var label = ExportFormatting.BuildGeneratedAtLabel(ctx);

        label.ShouldEndWith("Asia/Manila (UTC+08:00)");
    }
}
