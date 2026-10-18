using ClosedXML.Excel;
using MediatR;
using Microsoft.AspNetCore.Http;
using NSubstitute;
using WTF.Api.Endpoints;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Features.Reports.Enums;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Reports;

public class MonthlyReportWorkbookServiceTests
{
    private readonly FakeStorage _storage = new();
    private readonly ISender _sender = Substitute.For<ISender>();
    private readonly List<(string Query, DateTime? From, DateTime? To, string? TimeZone)> _calls = [];

    private OrderSourceEnum? _dailySource;
    private List<DailySalesReportRowDto> _daily = [];
    private List<DailyCloseReportRowDto> _close = [];
    private List<CategorySalesReportRowDto> _categories = [];
    private List<ProductSalesReportRowDto> _products = [];
    private List<PromotionPerformanceReportRowDto> _promotions = [];
    private List<PaymentsReportRowDto> _payments = [];
    private List<HourlySalesReportRowDto> _hourly = [];
    private List<StaffPerformanceReportRowDto> _staff = [];
    private List<CustomerReportRowDto> _customers = [];
    private List<CustomerLinkReportRowDto> _links = [];
    private List<VoidedOrderReportRowDto> _voids = [];
    private List<StockStatusReportRowDto> _stock = [];

    private static readonly string[] SheetNames =
    [
        "Daily Sales Summary",
        "Daily Close",
        "Sales by Category",
        "Product Sales Breakdown",
        "Promotions Performance",
        "Payment Method Breakdown",
        "Hourly Sales Distribution",
        "Staff Performance",
        "Customers",
        "Customer Link Orders",
        "Voids and Refunds",
        "Stock Status"
    ];

    private MonthlyReportWorkbookService Create(IHttpContextAccessor? accessor = null)
    {
        accessor ??= TestRequest.None();

        string? Tz() => accessor.HttpContext?.Request.Headers["X-TimeZone"].ToString();

        void Wire<TQuery, TRow>(List<TRow> Rows, Func<TQuery, (DateTime?, DateTime?)> range)
            where TQuery : IRequest<List<TRow>> =>
            _sender.Send((IRequest<List<TRow>>)Arg.Any<TQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
            {
                var q = ci.Arg<TQuery>();
                var (from, to) = range(q);
                _calls.Add((typeof(TQuery).Name, from, to, Tz()));
                return Task.FromResult(Rows);
            });

        _sender.Send(Arg.Any<GetDailySalesReportQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            var q = ci.Arg<GetDailySalesReportQuery>();
            _calls.Add((nameof(GetDailySalesReportQuery), q.FromDate, q.ToDate, Tz()));
            _dailySource = q.Source;
            q.GroupBy.ShouldBe(ReportGroupByEnum.Day);
            return Task.FromResult(_daily);
        });
        Wire<GetDailyCloseReportQuery, DailyCloseReportRowDto>(_close, q => (q.FromDate, q.ToDate));
        Wire<GetCategorySalesReportQuery, CategorySalesReportRowDto>(_categories, q => (q.FromDate, q.ToDate));
        Wire<GetProductSalesReportQuery, ProductSalesReportRowDto>(_products, q => (q.FromDate, q.ToDate));
        Wire<GetPromotionPerformanceReportQuery, PromotionPerformanceReportRowDto>(_promotions, q => (q.FromDate, q.ToDate));
        Wire<GetPaymentsReportQuery, PaymentsReportRowDto>(_payments, q => (q.FromDate, q.ToDate));
        Wire<GetHourlySalesReportQuery, HourlySalesReportRowDto>(_hourly, q => (q.FromDate, q.ToDate));
        Wire<GetStaffPerformanceReportQuery, StaffPerformanceReportRowDto>(_staff, q => (q.FromDate, q.ToDate));
        Wire<GetCustomersReportQuery, CustomerReportRowDto>(_customers, q => (q.FromDate, q.ToDate));
        Wire<GetCustomerLinkReportQuery, CustomerLinkReportRowDto>(_links, q => (q.FromDate, q.ToDate));
        Wire<GetVoidedOrdersReportQuery, VoidedOrderReportRowDto>(_voids, q => (q.FromDate, q.ToDate));
        Wire<GetStockStatusReportQuery, StockStatusReportRowDto>(_stock, _ => (null, null));

        return new MonthlyReportWorkbookService(_sender, accessor, _storage);
    }

    private static XLWorkbook Open(byte[] bytes) => new(new MemoryStream(bytes));

    private static string Text(IXLWorksheet ws, int row, int col) => ws.Cell(row, col).GetFormattedString();

    private static IHttpContextAccessor SettableAccessor(Func<HttpContext?> read, Action<HttpContext?> write)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(_ => read());
        accessor.When(a => a.HttpContext = Arg.Any<HttpContext?>()).Do(ci => write(ci.Arg<HttpContext?>()));
        return accessor;
    }

    // ---- status / download -------------------------------------------------------------------

    [Fact]
    public async Task GetStatusAsync_NothingStored_ReportsNotGenerated()
    {
        var status = await Create().GetStatusAsync(2026, 3, CancellationToken.None);

        status.Exists.ShouldBeFalse();
        status.Year.ShouldBe(2026);
        status.Month.ShouldBe(3);
        status.FileName.ShouldBe("WTF-Monthly-Reports-2026-03.xlsx");
        status.GeneratedAtUtc.ShouldBeNull();
        status.SizeBytes.ShouldBeNull();
    }

    [Fact]
    public async Task GetStatusAsync_FileStored_ReportsExistsWithTimestampAndSize()
    {
        var modified = new DateTimeOffset(2026, 3, 5, 10, 30, 0, TimeSpan.Zero);
        _storage.Files["reports/monthly/2026-03/WTF-Monthly-Reports-2026-03.xlsx"] = (new byte[] { 1, 2, 3 }, modified);

        var status = await Create().GetStatusAsync(2026, 3, CancellationToken.None);

        status.Exists.ShouldBeTrue();
        status.GeneratedAtUtc.ShouldBe(modified.UtcDateTime);
        status.SizeBytes.ShouldBe(3);
    }

    [Theory]
    [InlineData(1999, 5)]
    [InlineData(2101, 5)]
    [InlineData(2026, 0)]
    [InlineData(2026, 13)]
    public async Task GetStatusAsync_InvalidYearOrMonth_Throws(int year, int month)
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().GetStatusAsync(year, month, CancellationToken.None));
    }

    [Fact]
    public async Task GetFileAsync_NothingStored_ReturnsNull()
    {
        var result = await Create().GetFileAsync(2026, 3, CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task GetFileAsync_FileStored_ReturnsBytesAndFileName()
    {
        _storage.Files["reports/monthly/2026-03/WTF-Monthly-Reports-2026-03.xlsx"] = (new byte[] { 9, 8, 7 }, DateTimeOffset.UtcNow);

        var result = await Create().GetFileAsync(2026, 3, CancellationToken.None);

        result.ShouldNotBeNull();
        result.Value.Data.ShouldBe(new byte[] { 9, 8, 7 });
        result.Value.FileName.ShouldBe("WTF-Monthly-Reports-2026-03.xlsx");
    }

    [Fact]
    public async Task GetFileAsync_InvalidMonth_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().GetFileAsync(2026, 13, CancellationToken.None));
    }

    // ---- generate ----------------------------------------------------------------------------

    [Theory]
    [InlineData(2026, 2, 28)]
    [InlineData(2024, 2, 29)]
    [InlineData(2026, 12, 31)]
    [InlineData(2026, 4, 30)]
    public async Task GenerateAsync_FullMonth_QueriesFirstThroughLastDayOfMonth(int year, int month, int lastDay)
    {
        await Create().GenerateAsync(year, month, "Asia/Manila", CancellationToken.None);

        _calls.Count.ShouldBe(12);
        _calls.Select(c => c.Query).Distinct().Count().ShouldBe(12);
        _calls.Where(c => c.Query != nameof(GetStockStatusReportQuery)).ShouldAllBe(c => c.From == new DateTime(year, month, 1) && c.To == new DateTime(year, month, lastDay));
    }

    [Fact]
    public async Task GenerateAsync_Success_SavesWorkbookAtMonthPathAndReturnsStatus()
    {
        var status = await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        _storage.Files.Keys.ShouldBe(["reports/monthly/2026-03/WTF-Monthly-Reports-2026-03.xlsx"]);
        var saved = _storage.Saves.ShouldHaveSingleItem();
        saved.ContentType.ShouldBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        status.Exists.ShouldBeTrue();
        status.FileName.ShouldBe("WTF-Monthly-Reports-2026-03.xlsx");
        status.SizeBytes.ShouldBe(saved.Data.Length);
    }

    [Fact]
    public async Task GenerateAsync_ShopOrdersOnly_UsesItsOwnFileAndSkipsTheCustomerLinkSheet()
    {
        var status = await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None, OrderSourceEnum.Pos);

        _dailySource.ShouldBe(OrderSourceEnum.Pos);
        status.FileName.ShouldBe("WTF-Monthly-Reports-2026-03-Pos.xlsx");
        _storage.Files.Keys.ShouldBe(["reports/monthly/2026-03/WTF-Monthly-Reports-2026-03-Pos.xlsx"]);

        using var wb = new XLWorkbook(new MemoryStream(_storage.Saves.Single().Data));
        wb.Worksheets.Select(w => w.Name).ShouldBe(SheetNames.Where(n => n != "Customer Link Orders"));
    }

    [Fact]
    public async Task GenerateAsync_CustomerLinkOrdersOnly_KeepsAllSheetsInItsOwnFile()
    {
        var status = await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None, OrderSourceEnum.CustomerLink);

        _dailySource.ShouldBe(OrderSourceEnum.CustomerLink);
        status.FileName.ShouldBe("WTF-Monthly-Reports-2026-03-CustomerLink.xlsx");

        using var wb = new XLWorkbook(new MemoryStream(_storage.Saves.Single().Data));
        wb.Worksheets.Count.ShouldBe(12);
    }

    [Fact]
    public async Task GetStatusAsync_BySource_ChecksThatSourcesFileOnly()
    {
        _storage.Files["reports/monthly/2026-03/WTF-Monthly-Reports-2026-03.xlsx"] = ([1, 2, 3], DateTimeOffset.UtcNow);

        var all = await Create().GetStatusAsync(2026, 3, CancellationToken.None);
        var shop = await Create().GetStatusAsync(2026, 3, CancellationToken.None, OrderSourceEnum.Pos);

        all.Exists.ShouldBeTrue();
        shop.Exists.ShouldBeFalse();
        shop.FileName.ShouldBe("WTF-Monthly-Reports-2026-03-Pos.xlsx");
    }

    [Fact]
    public async Task GenerateAsync_InvalidMonth_ThrowsWithoutQueryingOrSaving()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().GenerateAsync(2026, 0, null, CancellationToken.None));

        _calls.ShouldBeEmpty();
        _storage.Saves.ShouldBeEmpty();
    }

    [Theory]
    [InlineData(null, "Asia/Manila")]
    [InlineData("", "Asia/Manila")]
    [InlineData("  ", "Asia/Manila")]
    [InlineData("UTC", "UTC")]
    public async Task GenerateAsync_RequestedTimeZone_IsSentToEveryQuery(string? requested, string expectedHeader)
    {
        await Create().GenerateAsync(2026, 3, requested, CancellationToken.None);

        _calls.Count.ShouldBe(12);
        _calls.ShouldAllBe(c => c.TimeZone == expectedHeader);
    }

    [Fact]
    public async Task GenerateAsync_NoHttpContext_RemovesTemporaryContextAfterwards()
    {
        HttpContext? current = null;
        var accessor = SettableAccessor(() => current, c => current = c);

        await Create(accessor).GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        _calls.ShouldAllBe(c => c.TimeZone == "Asia/Manila");
        current.ShouldBeNull();
    }

    [Fact]
    public async Task GenerateAsync_ExistingRequestHeader_IsRestoredAfterGeneration()
    {
        var accessor = TestRequest.As(Guid.NewGuid(), timeZone: "America/New_York");

        await Create(accessor).GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        _calls.ShouldAllBe(c => c.TimeZone == "Asia/Manila");
        accessor.HttpContext!.Request.Headers["X-TimeZone"].ToString().ShouldBe("America/New_York");
    }

    [Fact]
    public async Task GenerateAsync_ExistingRequestWithoutHeader_HeaderIsRemovedAfterGeneration()
    {
        var accessor = TestRequest.As(Guid.NewGuid());

        await Create(accessor).GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        accessor.HttpContext!.Request.Headers.ContainsKey("X-TimeZone").ShouldBeFalse();
    }

    [Fact]
    public async Task GenerateAsync_QueryFails_RestoresHeaderAndSavesNothing()
    {
        var accessor = TestRequest.As(Guid.NewGuid(), timeZone: "America/New_York");
        var service = Create(accessor);
        _sender.Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>())
            .Returns<Task<List<PaymentsReportRowDto>>>(_ => throw new InvalidOperationException("boom"));

        await Should.ThrowAsync<InvalidOperationException>(() =>
            service.GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None));

        _storage.Saves.ShouldBeEmpty();
        accessor.HttpContext!.Request.Headers["X-TimeZone"].ToString().ShouldBe("America/New_York");
    }

    [Fact]
    public async Task GenerateAsync_NoHttpContextAndQueryFails_StillClearsTemporaryContext()
    {
        HttpContext? current = null;
        var accessor = SettableAccessor(() => current, c => current = c);
        var service = Create(accessor);
        _sender.Send(Arg.Any<GetDailySalesReportQuery>(), Arg.Any<CancellationToken>())
            .Returns<Task<List<DailySalesReportRowDto>>>(_ => throw new InvalidOperationException("boom"));

        await Should.ThrowAsync<InvalidOperationException>(() =>
            service.GenerateAsync(2026, 3, null, CancellationToken.None));

        current.ShouldBeNull();
    }

    [Fact]
    public async Task GenerateAsync_StorageFails_ExceptionPropagates()
    {
        _storage.FailOnSave = true;

        await Should.ThrowAsync<IOException>(() =>
            Create().GenerateAsync(2026, 3, null, CancellationToken.None));
    }

    [Fact]
    public async Task GenerateAsync_RunTwice_OverwritesSameFile()
    {
        var service = Create();
        await service.GenerateAsync(2026, 3, null, CancellationToken.None);
        await service.GenerateAsync(2026, 3, null, CancellationToken.None);

        _storage.Files.Count.ShouldBe(1);
        _storage.Saves.Count.ShouldBe(2);
    }

    [Fact]
    public async Task GenerateAsync_UnknownTimeZone_FallsBackToUtcForGeneratedStamp()
    {
        await Create().GenerateAsync(2026, 3, "Not/AZone", CancellationToken.None);

        var saved = _storage.Saves.ShouldHaveSingleItem();
        using var wb = Open(saved.Data);
        Text(wb.Worksheet(1), 4, 1).ShouldEndWith(" UTC");
    }

    // ---- through date ------------------------------------------------------------------------

    [Fact]
    public async Task GenerateThroughDateAsync_DateInsideMonth_QueriesFirstOfMonthThroughThatDay()
    {
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 3, 14, 18, 45, 0), "Asia/Manila", null, CancellationToken.None);

        _calls.Where(c => c.Query != nameof(GetStockStatusReportQuery)).ShouldAllBe(c => c.From == new DateTime(2026, 3, 1) && c.To == new DateTime(2026, 3, 14));
    }

    [Fact]
    public async Task GenerateThroughDateAsync_DateBeforeMonthStart_ClampsToFirstDay()
    {
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 2, 20), "Asia/Manila", null, CancellationToken.None);

        _calls.Where(c => c.Query != nameof(GetStockStatusReportQuery)).ShouldAllBe(c => c.From == new DateTime(2026, 3, 1) && c.To == new DateTime(2026, 3, 1));
    }

    [Fact]
    public async Task GenerateThroughDateAsync_DateAfterMonthEnd_IsNotClamped()
    {
        // Documents current behaviour: the through-date is trusted even if it is past the end of the month.
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 4, 10), "Asia/Manila", null, CancellationToken.None);

        _calls.Where(c => c.Query != nameof(GetStockStatusReportQuery)).ShouldAllBe(c => c.To == new DateTime(2026, 4, 10));
    }

    [Fact]
    public async Task GenerateThroughDateAsync_InvalidMonth_Throws()
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().GenerateThroughDateAsync(2026, 14, new DateTime(2026, 1, 1), null, null, CancellationToken.None));
    }

    [Fact]
    public async Task GenerateThroughDateAsync_GeneratedAtOverride_IsUsedForLabelAndStoredTimestampInUtc()
    {
        // 23:59 Manila (UTC+8, no DST) is 15:59 UTC the same day.
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 3, 14), "Asia/Manila",
            new DateTime(2026, 3, 14, 23, 59, 0), CancellationToken.None);

        var saved = _storage.Saves.ShouldHaveSingleItem();
        saved.GeneratedAtUtc.ShouldBe(new DateTimeOffset(2026, 3, 14, 15, 59, 0, TimeSpan.Zero));
        using var wb = Open(saved.Data);
        Text(wb.Worksheet(1), 4, 1).ShouldBe("Generated: March 14, 2026 11:59 PM Asia/Manila");
    }

    [Fact]
    public async Task GenerateThroughDateAsync_NoOverride_StampsCurrentTimeConvertedToUtc()
    {
        var before = DateTimeOffset.UtcNow.AddSeconds(-2);
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 3, 14), "Asia/Manila", null, CancellationToken.None);
        var after = DateTimeOffset.UtcNow.AddSeconds(2);

        var generatedAt = _storage.Saves.ShouldHaveSingleItem().GeneratedAtUtc;
        generatedAt.ShouldNotBeNull();
        generatedAt.Value.ShouldBeInRange(before, after);
    }

    // ---- workbook content --------------------------------------------------------------------

    private void SeedSampleRows()
    {
        // gross - discounts - refunded = net on every row
        _daily =
        [
            new(new DateTime(2026, 3, 1), 1500m, 3, 500m, 50m, 1, 1, 100m, 1700m, 1500m, 100m),
            new(new DateTime(2026, 3, 2), 2500.5m, 2, 1250.25m, 0m, 0, 0, 0m, 2500.5m, 2500.5m, 0m)
        ];
        _close =
        [
            new("Sales", "Net sales", null, 5, 4000.5m),
            new("Payments", "Cash", "Tips PHP 50.00", 4, 3000m)
        ];
        _categories = [new("Food", 1203, 4300m, 100m, 100m, 4100m, 100m)];
        _products =
        [
            new(Guid.NewGuid(), "Latte", "Coffee", "Hot", 1200, 4000m, 62.5m, false, 4100m, 50m, 50m),
            new(Guid.NewGuid(), "Croissant", "Pastry", null, 3, 100m, 1.5m, false, 100m, 0m, 0m)
        ];
        _promotions = [new("20% off", "Discounted Product", 4, 320m, 80m)];
        _payments =
        [
            new("Cash", 4, 3000m, 75m, 3200m, 100m, 100m),
            new("GCash", 1, 1000.5m, 25m, 1000.5m, 0m, 0m)
        ];
        _hourly =
        [
            new(9, 2, 800m, 800m, 0m, 0m),
            new(23, 1, 200m, 250m, 50m, 0m)
        ];
        _staff =
        [
            new(Guid.NewGuid(), "Ana Cruz", 5, 4000m, 800m, 50m, 4100m, 50m, 50m)
        ];
        _customers = [new(Guid.NewGuid(), "Maria Santos", 2, 150m, 75m, new DateTime(2026, 3, 10, 12, 0, 0), true, 50)];
        _links = [new(Guid.NewGuid(), "Maria Santos", 3, 1, 1, 1, 1, 2, 100m, 10d, 15d, "Sold out")];
        _voids = [new(Guid.NewGuid(), 1001, new DateTime(2026, 3, 10, 12, 0, 0), new DateTime(2026, 3, 10, 14, 0, 0), "Refunded", "Ana Cruz", "Ben Reyes", 90m, "Wrong item", 25m)];
        _stock = [new(Guid.NewGuid(), "Milk", "l", 15m, 20m, 5m, "Warning", 10m, 150m)];
    }

    private async Task<XLWorkbook> GenerateSampleAsync(int month = 3)
    {
        SeedSampleRows();
        await Create().GenerateAsync(2026, month, "Asia/Manila", CancellationToken.None);
        return Open(_storage.Saves.Last().Data);
    }

    private static int RowOf(IXLWorksheet ws, string label)
    {
        for (var row = 1; row <= ws.LastRowUsed()!.RowNumber(); row++)
        {
            if (Text(ws, row, 1) == label)
            {
                return row;
            }
        }

        return -1;
    }

    private static string[] Row(IXLWorksheet ws, int row, int columns) =>
        Enumerable.Range(1, columns).Select(c => Text(ws, row, c)).ToArray();

    [Fact]
    public async Task GenerateAsync_Workbook_HasTwelveSheetsInOrder()
    {
        using var wb = await GenerateSampleAsync();

        wb.Worksheets.Select(w => w.Name).ShouldBe(SheetNames);
    }

    [Fact]
    public async Task GenerateAsync_EverySheet_UsesTheSameHeadersAsTheReportTable()
    {
        using var wb = await GenerateSampleAsync();

        void Check<T>(ReportTable<T> table) =>
            Row(wb.Worksheet(table.Title), 6, table.Columns.Count).ShouldBe(table.Columns.Select(c => c.Header).ToArray());

        Check(ReportTables.DailySales(ReportGroupByEnum.Day));
        Check(ReportTables.DailyClose);
        Check(ReportTables.CategorySales);
        Check(ReportTables.ProductSales);
        Check(ReportTables.Promotions);
        Check(ReportTables.Payments);
        Check(ReportTables.Hourly);
        Check(ReportTables.Staff);
        Check(ReportTables.Customers);
        Check(ReportTables.CustomerLinks);
        Check(ReportTables.Voids);
        Check(ReportTables.StockStatus);
    }

    [Fact]
    public async Task GenerateAsync_Workbook_HeaderBlockShowsCompanyTitleAndDateRange()
    {
        SeedSampleRows();
        await Create().GenerateAsync(2026, 2, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);
        var ws = wb.Worksheet("Payment Method Breakdown");
        Text(ws, 1, 1).ShouldBe("Wake.Taste.Focus by Faith");
        Text(ws, 2, 1).ShouldBe("Payment Method Breakdown");
        Text(ws, 3, 1).ShouldBe("Date Range: February 01, 2026 - February 28, 2026");
        Text(ws, 4, 1).ShouldStartWith("Generated: ");
    }

    [Fact]
    public async Task GenerateAsync_StockSheet_SaysItIsAsOfGenerationInsteadOfShowingARange()
    {
        using var wb = await GenerateSampleAsync();

        Text(wb.Worksheet("Stock Status"), 3, 1).ShouldBe("Stock levels as of the time this workbook was generated");
        Text(wb.Worksheet("Daily Sales Summary"), 3, 1).ShouldStartWith("Date Range: ");
    }

    [Fact]
    public async Task GenerateAsync_DailySheet_ShowsStepColumnsLongLabelsAndATotalRow()
    {
        using var wb = await GenerateSampleAsync();

        var ws = wb.Worksheet("Daily Sales Summary");
        Row(ws, 6, 9).ShouldBe(
            ["Period", "Gross Sales", "Discounts", "Refunded", "Net Sales", "Orders", "Avg/Order", "Tips", "Void/Cancelled"]);
        Row(ws, 7, 9).ShouldBe(
            ["March 01, 2026 (Sun)", "PHP 1,700.00", "PHP 100.00", "PHP 100.00", "PHP 1,500.00", "3", "PHP 500.00", "PHP 50.00", "1"]);
        Text(ws, 8, 5).ShouldBe("PHP 2,500.50");

        // The Total row follows the data rows: sums, and the average is total net over total orders.
        Row(ws, 9, 9).ShouldBe(
            ["Total", "PHP 4,200.50", "PHP 100.00", "PHP 100.00", "PHP 4,000.50", "5", "PHP 800.10", "PHP 50.00", "1"]);
    }

    [Fact]
    public async Task GenerateAsync_TotalRow_IsBoldOnEverySheetThatHasOne_AndTheRowsAboveAreNot()
    {
        using var wb = await GenerateSampleAsync();

        var sheets = new Dictionary<string, int>
        {
            ["Daily Sales Summary"] = 2,
            ["Sales by Category"] = 1,
            ["Product Sales Breakdown"] = 2,
            ["Promotions Performance"] = 1,
            ["Payment Method Breakdown"] = 2,
            ["Hourly Sales Distribution"] = 2,
            ["Staff Performance"] = 1,
            ["Customers"] = 1,
            ["Customer Link Orders"] = 1,
            ["Voids and Refunds"] = 1,
            ["Stock Status"] = 1,
        };
        foreach (var (name, dataRows) in sheets)
        {
            var ws = wb.Worksheet(name);
            var total = 6 + dataRows + 1;
            Text(ws, total, 1).ShouldBe("Total", name);
            ws.Cell(total, 1).Style.Font.Bold.ShouldBeTrue(name);
            ws.Cell(total - 1, 1).Style.Font.Bold.ShouldBeFalse(name);
        }
    }

    [Fact]
    public async Task GenerateAsync_DailyCloseSheet_HasNoTotalRow()
    {
        using var wb = await GenerateSampleAsync();

        var ws = wb.Worksheet("Daily Close");
        RowOf(ws, "Total").ShouldBe(-1);
        ws.Cell(7, 1).Style.Font.Bold.ShouldBeFalse();
        ws.Cell(8, 1).Style.Font.Bold.ShouldBeFalse();
    }

    [Fact]
    public async Task GenerateAsync_ProductSheet_CallsTheSubcategoryColumnSubcategoryType()
    {
        using var wb = await GenerateSampleAsync();

        Text(wb.Worksheet("Product Sales Breakdown"), 6, 3).ShouldBe("Subcategory/Type");
        ReportTables.ProductSales.Columns[2].Header.ShouldBe("Subcategory/Type");
    }

    [Fact]
    public async Task GenerateAsync_DailySheet_TotalRowFollowsTheStepIdentity()
    {
        using var wb = await GenerateSampleAsync();

        var ws = wb.Worksheet("Daily Sales Summary");
        decimal Money(int col) => decimal.Parse(Text(ws, 9, col).Replace("PHP ", string.Empty).Replace(",", string.Empty));

        (Money(2) - Money(3) - Money(4)).ShouldBe(Money(5));
    }

    [Fact]
    public async Task GenerateAsync_DailySheet_SummaryRepeatsTheTotals()
    {
        using var wb = await GenerateSampleAsync();

        var ws = wb.Worksheet("Daily Sales Summary");
        var summary = RowOf(ws, "Summary");
        summary.ShouldBeGreaterThan(9);
        Text(ws, RowOf(ws, "Gross Sales"), 2).ShouldBe("PHP 4,200.50");
        Text(ws, RowOf(ws, "Net Sales"), 2).ShouldBe("PHP 4,000.50");
        Text(ws, RowOf(ws, "Average Order Value"), 2).ShouldBe("PHP 800.10");
    }

    [Fact]
    public async Task GenerateAsync_ProductSheet_ShowsDashForMissingSubcategoryStepColumnsAndTotal()
    {
        using var wb = await GenerateSampleAsync();

        var ws = wb.Worksheet("Product Sales Breakdown");
        Row(ws, 7, 9).ShouldBe(
            ["Latte", "Coffee", "Hot", "1,200", "PHP 4,100.00", "PHP 50.00", "PHP 50.00", "PHP 4,000.00", "62.50%"]);
        Text(ws, 8, 3).ShouldBe("-");
        Text(ws, 9, 1).ShouldBe("Total");
        Text(ws, 9, 4).ShouldBe("1,203");
        Text(ws, 9, 8).ShouldBe("PHP 4,100.00");
    }

    [Fact]
    public async Task GenerateAsync_PaymentsHourlyAndStaffSheets_ShowRowsAndTotals()
    {
        using var wb = await GenerateSampleAsync();

        var pay = wb.Worksheet("Payment Method Breakdown");
        Row(pay, 7, 7).ShouldBe(["Cash", "4", "PHP 3,200.00", "PHP 100.00", "PHP 100.00", "PHP 3,000.00", "75.00%"]);
        Row(pay, 9, 7).ShouldBe(["Total", "5", "PHP 4,200.50", "PHP 100.00", "PHP 100.00", "PHP 4,000.50", "100.00%"]);

        var hourly = wb.Worksheet("Hourly Sales Distribution");
        Text(hourly, 7, 1).ShouldBe("09:00 - 10:00");
        Text(hourly, 8, 1).ShouldBe("23:00 - 00:00"); // hour 23 wraps to 00:00
        Row(hourly, 9, 6).ShouldBe(["Total", "3", "PHP 1,050.00", "PHP 50.00", "PHP 0.00", "PHP 1,000.00"]);

        var staff = wb.Worksheet("Staff Performance");
        Row(staff, 7, 8).ShouldBe(["Ana Cruz", "5", "PHP 4,100.00", "PHP 50.00", "PHP 50.00", "PHP 4,000.00", "PHP 800.00", "PHP 50.00"]);
        Row(staff, 8, 8).ShouldBe(["Total", "5", "PHP 4,100.00", "PHP 50.00", "PHP 50.00", "PHP 4,000.00", "PHP 800.00", "PHP 50.00"]);
    }

    [Fact]
    public async Task GenerateAsync_NewSheets_ShowTheirRows()
    {
        using var wb = await GenerateSampleAsync();

        Row(wb.Worksheet("Daily Close"), 7, 5).ShouldBe(["Sales", "Net sales", "-", "5", "PHP 4,000.50"]);
        Text(wb.Worksheet("Daily Close"), 9, 1).ShouldNotBe("Total"); // section rows are not summable

        var category = wb.Worksheet("Sales by Category");
        Text(category, 7, 1).ShouldBe("Food");
        Text(category, 8, 1).ShouldBe("Total");

        var promo = wb.Worksheet("Promotions Performance");
        Text(promo, 7, 1).ShouldBe("20% off");

        Row(wb.Worksheet("Customers"), 7, 8).ShouldContain("Maria Santos");
        Row(wb.Worksheet("Customer Link Orders"), 7, 6).ShouldContain("Maria Santos");
        Row(wb.Worksheet("Voids and Refunds"), 7, 6).ShouldContain("#1001");
        Row(wb.Worksheet("Stock Status"), 7, 5).ShouldContain("Milk");
    }

    [Fact]
    public async Task GenerateAsync_NoData_ProducesSheetsWithoutATotalRowAndZeroSummaries()
    {
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);
        wb.Worksheets.Count.ShouldBe(12);
        var ws = wb.Worksheet("Daily Sales Summary");
        Text(ws, 6, 1).ShouldBe("Period");
        Text(ws, 7, 1).ShouldNotBe("Total");
        Text(ws, RowOf(ws, "Gross Sales"), 2).ShouldBe("PHP 0.00");
        Text(ws, RowOf(ws, "Total Orders"), 2).ShouldBe("0");
        Text(ws, RowOf(ws, "Average Order Value"), 2).ShouldBe("PHP 0.00");
        Text(wb.Worksheet("Staff Performance"), 7, 1).ShouldNotBe("Total");
    }

    // ---- generation lock ---------------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_WhileAnotherManualRunIsGoing_ThrowsAndLeavesTheFirstRunAlone()
    {
        var started = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var first = Create();
        _sender.Send(Arg.Any<GetStockStatusReportQuery>(), Arg.Any<CancellationToken>()).Returns(async _ =>
        {
            started.SetResult();
            await release.Task;
            return _stock;
        });
        var running = first.GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);
        await started.Task;

        var second = await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None));
        release.SetResult();
        var status = await running;

        second.Message.ShouldContain("already being generated");
        status.Exists.ShouldBeTrue();
        _storage.Saves.Count.ShouldBe(1);
    }

    [Fact]
    public async Task GenerateAsync_ReleasesTheLockAfterAFailure()
    {
        var service = Create();
        _sender.Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>())
            .Returns<Task<List<PaymentsReportRowDto>>>(_ => throw new InvalidOperationException("boom"));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            service.GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None));

        var status = await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        status.Exists.ShouldBeTrue();
    }

    [Fact]
    public async Task GenerateAsync_ReleasesTheLockAfterSuccess()
    {
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        var status = await Create().GenerateAsync(2026, 4, "Asia/Manila", CancellationToken.None);

        status.Month.ShouldBe(4);
    }

    [Fact]
    public async Task GenerateThroughDateAsync_WaitsForARunningGenerationInsteadOfFailing()
    {
        var started = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var first = Create();
        _sender.Send(Arg.Any<GetStockStatusReportQuery>(), Arg.Any<CancellationToken>()).Returns(async _ =>
        {
            started.TrySetResult();
            await release.Task;
            return _stock;
        });
        var running = first.GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);
        await started.Task;

        var scheduled = Create().GenerateThroughDateAsync(2026, 3, new DateTime(2026, 3, 14), "Asia/Manila", null, CancellationToken.None);
        await Task.Delay(100);
        scheduled.IsCompleted.ShouldBeFalse();
        release.SetResult();
        await running;
        await scheduled;

        _storage.Saves.Count.ShouldBe(2);
    }

    // ---- fake storage ------------------------------------------------------------------------

    private sealed class FakeStorage : IReportFileStorage
    {
        public Dictionary<string, (byte[] Data, DateTimeOffset Modified)> Files { get; } = [];
        public List<(string Path, byte[] Data, string ContentType, DateTimeOffset? GeneratedAtUtc)> Saves { get; } = [];
        public bool FailOnSave { get; set; }

        public Task SaveAsync(string relativePath, byte[] data, string contentType, DateTimeOffset? generatedAtUtc, CancellationToken cancellationToken)
        {
            if (FailOnSave)
            {
                throw new IOException("disk full");
            }

            Saves.Add((relativePath, data, contentType, generatedAtUtc));
            Files[relativePath] = (data, generatedAtUtc ?? DateTimeOffset.UtcNow);
            return Task.CompletedTask;
        }

        public Task<byte[]?> ReadAllBytesAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(Files.TryGetValue(relativePath, out var f) ? f.Data : null);

        public Task<ReportFileInfo?> GetInfoAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(Files.TryGetValue(relativePath, out var f)
                ? new ReportFileInfo(relativePath, f.Data.Length, f.Modified)
                : null);
    }
}
