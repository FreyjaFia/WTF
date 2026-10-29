using WTF.Api.Common.Auth;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Tests.Features.Inventory;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class DailyCloseWasteSectionTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetDailyCloseReportHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetDailyCloseReportQuery Query(OrderSourceEnum? source = null) =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10), Source = source };

    [Fact]
    public async Task Handle_WasteOnTheDay_AddsOneRowPerItemInNameOrder()
    {
        Seed();

        var rows = await Handler().Handle(Query(), default);

        var waste = rows.Where(r => r.Section == GetDailyCloseReportHandler.WasteSection).ToList();
        waste.Select(r => r.Label).ShouldBe(["Cup", "Oat Milk"]);
        waste[0].Detail.ShouldBe("1 entry, 3 ml");
        waste[0].OrderCount.ShouldBe(1);
        waste[1].Detail.ShouldBe("2 entries, 250.5 ml");
        waste[1].OrderCount.ShouldBe(2);
        waste.ShouldAllBe(r => r.Amount == 0m);
    }

    [Fact]
    public async Task Handle_ReversedAndOtherDayWaste_AreLeftOut()
    {
        Seed();

        var rows = await Handler().Handle(Query(), default);

        rows.Where(r => r.Section == GetDailyCloseReportHandler.WasteSection).Sum(r => r.OrderCount).ShouldBe(3);
    }

    [Theory]
    [InlineData(OrderSourceEnum.Pos)]
    [InlineData(OrderSourceEnum.CustomerLink)]
    public async Task Handle_SourceFilter_LeavesOutWasteSection(OrderSourceEnum source)
    {
        Seed();

        var rows = await Handler().Handle(Query(source), default);

        rows.ShouldNotContain(r => r.Section == GetDailyCloseReportHandler.WasteSection);
    }

    private void Seed()
    {
        var milk = StockSeed.Item(_dbName, "Oat Milk", 1000m);
        var cup = StockSeed.Item(_dbName, "Cup", 100m);
        var reason = WasteSeed.Reason(_dbName);
        var user = WasteSeed.User(_dbName, AppRoles.Cashier);

        WasteSeed.Entry(_dbName, milk, reason, user, 200m, createdAt: Noon);
        WasteSeed.Entry(_dbName, milk, reason, user, 50.5m, StockWasteStatuses.Confirmed, Noon);
        WasteSeed.Entry(_dbName, milk, reason, user, 400m, StockWasteStatuses.Reversed, Noon);
        WasteSeed.Entry(_dbName, milk, reason, user, 70m, createdAt: Utc(2026, 3, 11, 4));
        WasteSeed.Entry(_dbName, cup, reason, user, 3m, createdAt: Noon);
    }
}
