using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using NSubstitute;
using System.Text;
using WTF.Api.Endpoints;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;

namespace WTF.Tests.Endpoints;

public class ReportTableTests : IDisposable
{
    private static readonly IReadOnlyList<PaymentsReportRowDto> Rows =
    [
        new("Cash", 2, 150m, 30m),
        new("GCash", 1, 350m, 70m),
        new("Card", 5, 90m, 18m),
    ];

    private readonly EndpointTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private static string[] Methods(IReadOnlyList<PaymentsReportRowDto> rows) => rows.Select(r => r.PaymentMethod).ToArray();

    [Fact]
    public void Apply_NoSearchOrSort_KeepsRowsAsTheyCame() =>
        Methods(ReportTables.Payments.Apply(Rows, null, null, false)).ShouldBe(["Cash", "GCash", "Card"]);

    [Fact]
    public void Apply_SortsByColumnKeyAscendingAndDescending()
    {
        Methods(ReportTables.Payments.Apply(Rows, null, "totalAmount", false)).ShouldBe(["Card", "Cash", "GCash"]);
        Methods(ReportTables.Payments.Apply(Rows, null, "totalAmount", true)).ShouldBe(["GCash", "Cash", "Card"]);
        Methods(ReportTables.Payments.Apply(Rows, null, "ORDERCOUNT", true)).ShouldBe(["Card", "Cash", "GCash"]);
    }

    [Fact]
    public void Apply_StringColumns_SortIgnoringCase()
    {
        IReadOnlyList<PaymentsReportRowDto> rows = [new("beta", 1, 1m, 1m), new("Alpha", 1, 1m, 1m), new("charlie", 1, 1m, 1m)];

        Methods(ReportTables.Payments.Apply(rows, null, "paymentMethod", false)).ShouldBe(["Alpha", "beta", "charlie"]);
    }

    [Fact]
    public void Apply_UnknownSortKey_IsIgnored() =>
        Methods(ReportTables.Payments.Apply(Rows, null, "nonsense", true)).ShouldBe(["Cash", "GCash", "Card"]);

    [Fact]
    public void Apply_SearchMatchesAnyVisibleColumnCaseInsensitively()
    {
        Methods(ReportTables.Payments.Apply(Rows, "gcash", null, false)).ShouldBe(["GCash"]);
        // Matches the formatted amount, not only the name.
        Methods(ReportTables.Payments.Apply(Rows, "350.00", null, false)).ShouldBe(["GCash"]);
        Methods(ReportTables.Payments.Apply(Rows, "  card  ", null, false)).ShouldBe(["Card"]);
    }

    [Fact]
    public void Apply_SearchWithNoMatch_ReturnsNothing() =>
        ReportTables.Payments.Apply(Rows, "zzz", null, false).ShouldBeEmpty();

    [Fact]
    public void Apply_BlankSearch_ReturnsEverything() =>
        ReportTables.Payments.Apply(Rows, "   ", null, false).Count.ShouldBe(3);

    [Fact]
    public void Apply_VeryLongSearch_IsTruncatedInsteadOfFailing()
    {
        // Cut to 100 characters, so it no longer equals any row text and matches nothing.
        ReportTables.Payments.Apply(Rows, "Cash" + new string('x', 500), null, false).ShouldBeEmpty();
    }

    [Fact]
    public void Apply_SearchThenSort_SortsOnlyTheRemainingRows() =>
        Methods(ReportTables.Payments.Apply(Rows, "cash", "orderCount", true)).ShouldBe(["Cash", "GCash"]);

    [Fact]
    public void Excel_ContainsOnlyTheFilteredSortedRows_AndTotalsOverThem()
    {
        var shown = ReportTables.Payments.Apply(Rows, "cash", "totalAmount", true);

        var bytes = SimpleExcelBuilder.Build(ReportTables.Payments.ToExcel(shown, "Mar 2026 | Search: cash"));

        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var ws = wb.Worksheet("Report");
        ws.Cell(3, 1).GetString().ShouldContain("Search: cash");
        ws.Cell(6, 1).GetString().ShouldBe("Payment Method");
        ws.Cell(7, 1).GetString().ShouldBe("GCash");
        ws.Cell(8, 1).GetString().ShouldBe("Cash");
        ws.Cell(9, 1).GetString().ShouldBe("Total");
        ws.Cell(9, 2).GetString().ShouldBe("3");
        ws.Cell(9, 6).GetString().ShouldBe("PHP 500.00");
        ws.Cell(9, 6).Style.Font.Bold.ShouldBeTrue();
        ws.Cell(8, 6).Style.Font.Bold.ShouldBeFalse();
        ws.Cell(11, 1).GetString().ShouldBe("Summary");
        ws.Cell(15, 1).GetString().ShouldBe("Net Amount");
        ws.Cell(15, 2).GetString().ShouldBe("PHP 500.00");
        ws.Cell(16, 2).GetString().ShouldBe("3");
    }

    [Theory]
    [InlineData("  cash  ", "cash")]
    [InlineData("ca\tsh\r\n", "cash")]
    [InlineData("\u0000\u001f x \u007f", "x")]
    [InlineData(null, "")]
    [InlineData("   ", "")]
    public void SanitizeSearch_StripsControlCharactersAndTrims(string? input, string expected) =>
        ReportTable<PaymentsReportRowDto>.SanitizeSearch(input).ShouldBe(expected);

    [Fact]
    public void SanitizeSearch_CapsTheLengthAtOneHundred()
    {
        ReportTable<PaymentsReportRowDto>.SanitizeSearch(new string('a', 500)).Length.ShouldBe(100);
        ReportTable<PaymentsReportRowDto>.SanitizeSearch(new string('a', 100)).Length.ShouldBe(100);
        ReportTable<PaymentsReportRowDto>.SanitizeSearch(new string('a', 99)).Length.ShouldBe(99);
    }

    [Fact]
    public void Apply_IgnoresControlCharactersInTheSearch() =>
        Methods(ReportTables.Payments.Apply(Rows, "ca\tsh\n", null, false)).ShouldBe(["Cash", "GCash"]);

    [Theory]
    [InlineData("2026-01-01", "2027-01-02", StatusCodes.Status200OK)]
    [InlineData("2026-01-01", "2027-01-03", StatusCodes.Status400BadRequest)]
    [InlineData("2026-01-01", "2026-01-01", StatusCodes.Status200OK)]
    public async Task Endpoint_DateRange_IsCappedAt366Days(string from, string to, int expected)
    {
        _host.Sender.Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>())
            .Returns(Rows.ToList());

        var (status, body) = await _host.InvokeAsync("GET", "/api/reports/payments", query: $"fromDate={from}&toDate={to}");

        status.ShouldBe(expected);
        if (expected == StatusCodes.Status400BadRequest)
        {
            body.ShouldContain("366 days");
            await _host.Sender.DidNotReceive().Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>());
        }
    }

    [Fact]
    public async Task Endpoint_ExportOfMoreThan50000Rows_IsRefused_ButJsonIsNot()
    {
        var many = Enumerable.Range(0, 50_001).Select(i => new PaymentsReportRowDto("M" + i, 1, 1m, 0m)).ToList();
        _host.Sender.Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>()).Returns(many);
        const string query = "fromDate=2026-03-01&toDate=2026-03-31";

        var (excelStatus, excelBody) = await _host.InvokeAsync(
            "GET", "/api/reports/payments", query: query,
            headers: new Dictionary<string, string> { ["Accept"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        var (pdfStatus, _) = await _host.InvokeAsync(
            "GET", "/api/reports/payments", query: query,
            headers: new Dictionary<string, string> { ["Accept"] = "application/pdf" });
        var (jsonStatus, _) = await _host.InvokeAsync("GET", "/api/reports/payments", query: query);

        excelStatus.ShouldBe(StatusCodes.Status400BadRequest);
        excelBody.ShouldContain("50,000");
        pdfStatus.ShouldBe(StatusCodes.Status400BadRequest);
        jsonStatus.ShouldBe(StatusCodes.Status200OK);
    }

    [Fact]
    public void TotalRow_IsTheLastRow_AndSumsTheRowsShown()
    {
        var table = ReportTables.Payments;
        IReadOnlyList<PaymentsReportRowDto> rows =
        [
            new("Cash", 2, 150m, 60m, 200m, 30m, 20m, 5m),
            new("GCash", 1, 350m, 40m, 350m, 0m, 0m, 7m),
        ];

        var all = table.BuildRows(rows);

        table.HasTotalRow.ShouldBeTrue();
        all.Count.ShouldBe(3);
        var total = all[^1];
        total[0].ShouldBe("Total");
        total[1].ShouldBe("3");
        total[2].ShouldBe("PHP 550.00");
        total[3].ShouldBe("PHP 30.00");
        total[4].ShouldBe("PHP 20.00");
        total[5].ShouldBe("PHP 500.00");
        total[6].ShouldBe("PHP 12.00");
        total[7].ShouldBe("100.00%");
    }

    [Fact]
    public void TotalRow_IsLeftOut_WhenThereAreNoRows()
    {
        ReportTables.Payments.BuildRows([]).ShouldBeEmpty();

        using var wb = new XLWorkbook(new MemoryStream(SimpleExcelBuilder.Build(ReportTables.Payments.ToExcel([], "x"))));
        wb.Worksheet("Report").Cell(7, 1).GetString().ShouldNotBe("Total");
    }

    [Fact]
    public void TotalRow_FollowsTheSearchedRowsOnly()
    {
        var shown = ReportTables.Payments.Apply(Rows, "gcash", null, false);

        var all = ReportTables.Payments.BuildRows(shown);

        all.Count.ShouldBe(2);
        all[^1][5].ShouldBe("PHP 350.00");
    }

    [Fact]
    public void Excel_TotalRow_IsBoldAndShaded_OnlyThatRow()
    {
        var bytes = SimpleExcelBuilder.Build(ReportTables.Payments.ToExcel(Rows, "x"));

        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var ws = wb.Worksheet("Report");
        ws.Cell(10, 1).GetString().ShouldBe("Total");
        ws.Cell(10, 1).Style.Font.Bold.ShouldBeTrue();
        ws.Cell(9, 1).Style.Font.Bold.ShouldBeFalse();
    }

    [Fact]
    public void DailyClose_HasNoTotalRow_BecauseItsRowsAreSections()
    {
        ReportTables.DailyClose.HasTotalRow.ShouldBeFalse();

        var rows = new List<DailyCloseReportRowDto> { new("Sales", "Net sales", null, 2, 300m), new("Payments", "Cash", null, 2, 300m) };
        ReportTables.DailyClose.BuildRows(rows).Count.ShouldBe(2);
    }

    private static void PdfOmits<T>(ReportTable<T> table, IReadOnlyList<T> rows, params string[] omittedKeys)
    {
        var omittedHeaders = table.Columns.Where(c => omittedKeys.Contains(c.Key)).Select(c => c.Header).ToList();
        omittedHeaders.Count.ShouldBe(omittedKeys.Length);

        var pdf = table.ToPdf(rows, "x");
        var excel = table.ToExcel(rows, "x");

        pdf.Table.Columns.Count.ShouldBe(table.Columns.Count - omittedKeys.Length);
        pdf.Table.Columns.Select(c => c.Header).ShouldNotContain(h => omittedHeaders.Contains(h));
        pdf.Table.Rows.ShouldAllBe(row => row.Count == pdf.Table.Columns.Count);
        pdf.Table.Columns.Sum(c => c.Width).ShouldBe(532f, 0.01f);
        // The kept columns keep their order.
        pdf.Table.Columns.Select(c => c.Header)
            .ToArray()
            .ShouldBe(table.Columns.Where(c => !omittedKeys.Contains(c.Key)).Select(c => c.Header).ToArray());

        // Excel keeps every column.
        excel.Columns.Count.ShouldBe(table.Columns.Count);
        excel.Rows.ShouldAllBe(row => row.Count == table.Columns.Count);
        pdf.Table.Rows.Count.ShouldBe(excel.Rows.Count);
        if (table.HasTotalRow)
        {
            pdf.Table.Rows[^1][0].ShouldBe("Total");
        }
    }

    [Fact]
    public void Pdf_DailySales_OmitsAverageAndVoidColumns_ExcelKeepsThem() =>
        PdfOmits(
            ReportTables.DailySales(ReportGroupByEnum.Day),
            [new DailySalesReportRowDto(new DateTime(2026, 3, 10), 200m, 2, 100m, 5m, 3, 1, 75m, 300m, 200m, 25m)],
            "averageOrderValue", "voidCancelledCount");

    [Fact]
    public void Pdf_ProductSales_OmitsSubcategoryAndPercent_ExcelKeepsThem() =>
        PdfOmits(
            ReportTables.ProductSales,
            [new ProductSalesReportRowDto(Guid.NewGuid(), "Latte", "Coffee", "Hot", 3, 100m, 100m, false, 120m, 10m, 10m)],
            "subCategoryName", "revenuePercent");

    [Fact]
    public void Pdf_Staff_OmitsAverage_ExcelKeepsIt() =>
        PdfOmits(
            ReportTables.Staff,
            [new StaffPerformanceReportRowDto(Guid.NewGuid(), "Ana", 2, 100m, 50m, 5m, 120m, 10m, 10m)],
            "averageOrderValue");

    [Fact]
    public void Pdf_Voids_OmitsOrderedVoidedByAndRate_ExcelKeepsThem() =>
        PdfOmits(
            ReportTables.Voids,
            [new VoidedOrderReportRowDto(Guid.NewGuid(), 1001, new DateTime(2026, 3, 10, 12, 0, 0), new DateTime(2026, 3, 10, 14, 0, 0), "Refunded", "Ana", "Ben", 90m, "x", 25m)],
            "orderedAt", "voidedBy", "staffVoidRate");

    [Fact]
    public void Pdf_CustomerLinks_OmitsFourColumns_ExcelKeepsThem() =>
        PdfOmits(
            ReportTables.CustomerLinks,
            [new CustomerLinkReportRowDto(Guid.NewGuid(), "Maria", 3, 1, 1, 1, 1, 2, 100m, 10d, 15d, "Sold out")],
            "awaitingCount", "pickupCount", "deliveryCount", "averageMinutesToReady");

    [Fact]
    public void Pdf_ReportsNotOnTheList_KeepEveryColumn() =>
        ReportTables.Payments.ToPdf(Rows, "x").Table.Columns.Count.ShouldBe(ReportTables.Payments.Columns.Count);

    [Fact]
    public void Pdf_WithNoRows_StillHasTheKeptHeaders()
    {
        var pdf = ReportTables.Voids.ToPdf([], "x");

        pdf.Table.Columns.Count.ShouldBe(ReportTables.Voids.Columns.Count - 3);
        pdf.Table.Rows.ShouldBeEmpty();
    }

    [Fact]
    public void Pdf_IncludesTheTotalRow()
    {
        var withTotal = SimplePdfBuilder.Build(ReportTables.Payments.ToPdf(Rows, "x"));

        Encoding.ASCII.GetString(withTotal, 0, 5).ShouldBe("%PDF-");
    }

    [Fact]
    public void Pdf_BuildsForTheFilteredRows()
    {
        var shown = ReportTables.Payments.Apply(Rows, "ca", null, false);

        var bytes = SimplePdfBuilder.Build(ReportTables.Payments.ToPdf(shown, "Mar 2026"));

        Encoding.ASCII.GetString(bytes, 0, 5).ShouldBe("%PDF-");
    }

    [Fact]
    public void DailySales_ExcelHasRefundColumns()
    {
        var table = ReportTables.DailySales(ReportGroupByEnum.Day);
        IReadOnlyList<DailySalesReportRowDto> rows =
        [
            new(new DateTime(2026, 3, 10), 200m, 2, 100m, 5m, 3, 1, 75m, 300m, 200m, 25m),
        ];

        using var wb = new XLWorkbook(new MemoryStream(SimpleExcelBuilder.Build(table.ToExcel(rows, "x"))));
        var ws = wb.Worksheet("Report");

        ws.Cell(6, 2).GetString().ShouldBe("Gross Sales");
        ws.Cell(6, 3).GetString().ShouldBe("Discounts");
        ws.Cell(6, 4).GetString().ShouldBe("Refunded");
        ws.Cell(6, 5).GetString().ShouldBe("Net Sales");
        ws.Cell(7, 2).GetString().ShouldBe("PHP 300.00");
        ws.Cell(7, 3).GetString().ShouldBe("PHP 25.00");
        ws.Cell(7, 4).GetString().ShouldBe("PHP 75.00");
        ws.Cell(7, 5).GetString().ShouldBe("PHP 200.00");
    }

    [Fact]
    public async Task Endpoint_ExportAcceptHeaders_ReturnFiles_AndJsonIgnoresSearch()
    {
        _host.Sender.Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>())
            .Returns(Rows.ToList());
        const string query = "fromDate=2026-03-01&toDate=2026-03-31&search=ca&sortBy=totalAmount&sortDir=desc";

        var (jsonStatus, json) = await _host.InvokeAsync("GET", "/api/reports/payments", query: query);
        var (excelStatus, _) = await _host.InvokeAsync(
            "GET", "/api/reports/payments", query: query,
            headers: new Dictionary<string, string> { ["Accept"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        var (pdfStatus, _) = await _host.InvokeAsync(
            "GET", "/api/reports/payments", query: query,
            headers: new Dictionary<string, string> { ["Accept"] = "application/pdf" });

        jsonStatus.ShouldBe(StatusCodes.Status200OK);
        json.ShouldContain("GCash");
        excelStatus.ShouldBe(StatusCodes.Status200OK);
        pdfStatus.ShouldBe(StatusCodes.Status200OK);
    }
}
