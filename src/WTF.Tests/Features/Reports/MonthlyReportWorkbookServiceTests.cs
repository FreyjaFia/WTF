using ClosedXML.Excel;
using MediatR;
using Microsoft.AspNetCore.Http;
using NSubstitute;
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

    private List<DailySalesReportRowDto> _daily = [];
    private List<ProductSalesReportRowDto> _products = [];
    private List<PaymentsReportRowDto> _payments = [];
    private List<HourlySalesReportRowDto> _hourly = [];
    private List<StaffPerformanceReportRowDto> _staff = [];

    private MonthlyReportWorkbookService Create(IHttpContextAccessor? accessor = null)
    {
        accessor ??= TestRequest.None();

        string? Tz() => accessor.HttpContext?.Request.Headers["X-TimeZone"].ToString();

        _sender.Send(Arg.Any<GetDailySalesReportQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            var q = ci.Arg<GetDailySalesReportQuery>();
            _calls.Add((nameof(GetDailySalesReportQuery), q.FromDate, q.ToDate, Tz()));
            q.GroupBy.ShouldBe(ReportGroupByEnum.Day);
            return Task.FromResult(_daily);
        });
        _sender.Send(Arg.Any<GetProductSalesReportQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            var q = ci.Arg<GetProductSalesReportQuery>();
            _calls.Add((nameof(GetProductSalesReportQuery), q.FromDate, q.ToDate, Tz()));
            return Task.FromResult(_products);
        });
        _sender.Send(Arg.Any<GetPaymentsReportQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            var q = ci.Arg<GetPaymentsReportQuery>();
            _calls.Add((nameof(GetPaymentsReportQuery), q.FromDate, q.ToDate, Tz()));
            return Task.FromResult(_payments);
        });
        _sender.Send(Arg.Any<GetHourlySalesReportQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            var q = ci.Arg<GetHourlySalesReportQuery>();
            _calls.Add((nameof(GetHourlySalesReportQuery), q.FromDate, q.ToDate, Tz()));
            return Task.FromResult(_hourly);
        });
        _sender.Send(Arg.Any<GetStaffPerformanceReportQuery>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            var q = ci.Arg<GetStaffPerformanceReportQuery>();
            _calls.Add((nameof(GetStaffPerformanceReportQuery), q.FromDate, q.ToDate, Tz()));
            return Task.FromResult(_staff);
        });

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

        _calls.Select(c => c.Query).ShouldBe(
        [
            nameof(GetDailySalesReportQuery),
            nameof(GetProductSalesReportQuery),
            nameof(GetPaymentsReportQuery),
            nameof(GetHourlySalesReportQuery),
            nameof(GetStaffPerformanceReportQuery)
        ]);
        _calls.ShouldAllBe(c => c.From == new DateTime(year, month, 1) && c.To == new DateTime(year, month, lastDay));
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

        _calls.Count.ShouldBe(5);
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

        _calls.ShouldAllBe(c => c.From == new DateTime(2026, 3, 1) && c.To == new DateTime(2026, 3, 14));
    }

    [Fact]
    public async Task GenerateThroughDateAsync_DateBeforeMonthStart_ClampsToFirstDay()
    {
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 2, 20), "Asia/Manila", null, CancellationToken.None);

        _calls.ShouldAllBe(c => c.From == new DateTime(2026, 3, 1) && c.To == new DateTime(2026, 3, 1));
    }

    [Fact]
    public async Task GenerateThroughDateAsync_DateAfterMonthEnd_IsNotClamped()
    {
        // Documents current behaviour: the through-date is trusted even if it is past the end of the month.
        await Create().GenerateThroughDateAsync(
            2026, 3, new DateTime(2026, 4, 10), "Asia/Manila", null, CancellationToken.None);

        _calls.ShouldAllBe(c => c.To == new DateTime(2026, 4, 10));
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
        _daily =
        [
            new(new DateTime(2026, 3, 1), 1500m, 3, 500m, 50m, 1),
            new(new DateTime(2026, 3, 2), 2500.5m, 2, 1250.25m, 0m, 0)
        ];
        _products =
        [
            new(Guid.NewGuid(), "Latte", "Coffee", "Hot", 1200, 4000m, 62.5m),
            new(Guid.NewGuid(), "Croissant", "Pastry", null, 3, 100m, 1.5m)
        ];
        _payments =
        [
            new("Cash", 4, 3000m, 75m),
            new("GCash", 1, 1000.5m, 25m)
        ];
        _hourly =
        [
            new(9, 2, 800m),
            new(23, 1, 200m)
        ];
        _staff =
        [
            new(Guid.NewGuid(), "Ana Cruz", 5, 4000m, 800m, 50m)
        ];
    }

    [Fact]
    public async Task GenerateAsync_Workbook_HasFiveSheetsInOrder()
    {
        SeedSampleRows();
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);
        wb.Worksheets.Select(w => w.Name).ShouldBe(
        [
            "Daily Sales Summary",
            "Product Sales Breakdown",
            "Payment Method Breakdown",
            "Hourly Sales Distribution",
            "Staff Performance"
        ]);
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
    public async Task GenerateAsync_DailySheet_FormatsRowsAndSummary()
    {
        SeedSampleRows();
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);
        var ws = wb.Worksheet("Daily Sales Summary");
        new[] { 1, 2, 3, 4, 5, 6 }.Select(c => Text(ws, 6, c)).ShouldBe(
            ["Date", "Revenue", "Orders", "Avg/Order", "Tips", "Void/Cancelled"]);
        new[] { 1, 2, 3, 4, 5, 6 }.Select(c => Text(ws, 7, c)).ShouldBe(
            ["Mar 01, 2026 (Sun)", "PHP 1,500.00", "3", "PHP 500.00", "PHP 50.00", "1"]);
        Text(ws, 8, 2).ShouldBe("PHP 2,500.50");

        // Rows 7-8, blank row 9, "Summary" row 10, items from row 11.
        Text(ws, 10, 1).ShouldBe("Summary");
        Text(ws, 11, 1).ShouldBe("Total Revenue");
        Text(ws, 11, 2).ShouldBe("PHP 4,000.50");
        Text(ws, 12, 2).ShouldBe("5");
        Text(ws, 13, 1).ShouldBe("Average Order Value");
        Text(ws, 13, 2).ShouldBe("PHP 800.10"); // 4000.50 / 5
        Text(ws, 14, 2).ShouldBe("PHP 50.00");
        Text(ws, 15, 2).ShouldBe("1");
    }

    [Fact]
    public async Task GenerateAsync_ProductSheet_ShowsDashForMissingSubcategoryAndFormatsNumbers()
    {
        SeedSampleRows();
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);
        var ws = wb.Worksheet("Product Sales Breakdown");
        new[] { 1, 2, 3, 4, 5, 6 }.Select(c => Text(ws, 7, c)).ShouldBe(
            ["Latte", "Coffee", "Hot", "1,200", "PHP 4,000.00", "62.50%"]);
        Text(ws, 8, 3).ShouldBe("-");
        Text(ws, 11, 2).ShouldBe("PHP 4,100.00");
        Text(ws, 12, 2).ShouldBe("1,203");
    }

    [Fact]
    public async Task GenerateAsync_PaymentsHourlyAndStaffSheets_ShowRowsAndTotals()
    {
        SeedSampleRows();
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);

        var pay = wb.Worksheet("Payment Method Breakdown");
        new[] { 1, 2, 3, 4 }.Select(c => Text(pay, 7, c)).ShouldBe(["Cash", "4", "PHP 3,000.00", "75.00%"]);
        Text(pay, 11, 2).ShouldBe("PHP 4,000.50");
        Text(pay, 12, 2).ShouldBe("5");

        var hourly = wb.Worksheet("Hourly Sales Distribution");
        Text(hourly, 7, 1).ShouldBe("09:00 - 10:00");
        Text(hourly, 8, 1).ShouldBe("23:00 - 00:00"); // hour 23 wraps to 00:00
        Text(hourly, 11, 2).ShouldBe("PHP 1,000.00");

        var staff = wb.Worksheet("Staff Performance");
        new[] { 1, 2, 3, 4, 5 }.Select(c => Text(staff, 7, c)).ShouldBe(
            ["Ana Cruz", "5", "PHP 4,000.00", "PHP 800.00", "PHP 50.00"]);
        Text(staff, 10, 1).ShouldBe("Total Revenue");
        Text(staff, 12, 2).ShouldBe("PHP 800.00");
    }

    [Fact]
    public async Task GenerateAsync_NoData_ProducesSheetsWithZeroTotalsAndNoDivisionByZero()
    {
        await Create().GenerateAsync(2026, 3, "Asia/Manila", CancellationToken.None);

        using var wb = Open(_storage.Saves.Single().Data);
        var ws = wb.Worksheet("Daily Sales Summary");
        Text(ws, 6, 1).ShouldBe("Date");
        // No data rows: blank row 7, "Summary" at row 8, items from row 9.
        Text(ws, 8, 1).ShouldBe("Summary");
        Text(ws, 9, 2).ShouldBe("PHP 0.00");
        Text(ws, 10, 2).ShouldBe("0");
        Text(ws, 11, 2).ShouldBe("PHP 0.00");

        var staff = wb.Worksheet("Staff Performance");
        Text(staff, 11, 2).ShouldBe("PHP 0.00");
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
