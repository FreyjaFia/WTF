using WTF.Calculations.Inventory;
using WTF.Calculations.Time;

namespace WTF.Tests.Calculations;

public class StockRulesTests
{
    [Theory]
    [InlineData(0, 20, 5, StockStatus.OutOfStock)]
    [InlineData(-2, 20, 5, StockStatus.OutOfStock)]
    [InlineData(5, 20, 5, StockStatus.Critical)]
    [InlineData(6, 20, 5, StockStatus.Warning)]
    [InlineData(20, 20, 5, StockStatus.Warning)]
    [InlineData(21, 20, 5, StockStatus.Ok)]
    public void StatusFor_UsesInclusiveLevels(int quantity, int warning, int critical, StockStatus expected) =>
        StockRules.StatusFor(quantity, warning, critical).ShouldBe(expected);

    [Fact]
    public void StatusFor_NoLevels_IsOkUnlessEmpty()
    {
        StockRules.StatusFor(1m, null, null).ShouldBe(StockStatus.Ok);
        StockRules.StatusFor(0m, null, null).ShouldBe(StockStatus.OutOfStock);
    }

    [Fact]
    public void StatusFor_OnlyWarningLevel_NeverCritical() =>
        StockRules.StatusFor(2m, 10m, null).ShouldBe(StockStatus.Warning);

    [Theory]
    [InlineData(15, 10, 150)]
    [InlineData(15, null, 0)]
    [InlineData(-4, 10, 0)]
    [InlineData(0, 10, 0)]
    public void StockValue_IsQuantityTimesCost_NeverNegative(int quantity, int? cost, int expected) =>
        StockRules.StockValue(quantity, cost).ShouldBe(expected);

    [Fact]
    public void LocalDateTime_ConvertsUtcToTheShopClock()
    {
        var manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

        var local = ReportPeriods.LocalDateTime(new DateTime(2026, 3, 10, 16, 30, 0, DateTimeKind.Utc), manila);

        local.ShouldBe(new DateTime(2026, 3, 11, 0, 30, 0));
        local.Kind.ShouldBe(DateTimeKind.Unspecified);
    }
}
