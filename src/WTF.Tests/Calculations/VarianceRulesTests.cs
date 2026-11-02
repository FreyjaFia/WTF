using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class VarianceRulesTests
{
    private static VarianceMovement M(string type, decimal delta, decimal? cost = null) => new(type, delta, cost);

    [Fact]
    public void Summarize_CountFindsLessThanTheLedger_IsPositiveVarianceWithValue()
    {
        var summary = VarianceRules.Summarize([
            M("AddStock", 1000m),
            M("Sale", -180m, 0.15m),
            M("Sale", -180m, 0.15m),
            M("Waste", -50m, 0.15m),
            M("Count", -30m, 0.15m)]);

        summary.Received.ShouldBe(1000m);
        summary.TheoreticalUsage.ShouldBe(360m);
        summary.Waste.ShouldBe(50m);
        summary.Corrections.ShouldBe(-30m);
        summary.ActualUsage.ShouldBe(440m);
        summary.Variance.ShouldBe(30m);
        summary.VariancePercent.ShouldBe(8.3m);
        summary.VarianceValue.ShouldBe(4.5m);
        summary.WasCounted.ShouldBeTrue();
    }

    [Fact]
    public void Summarize_VoidAndReversedWasteGiveBack()
    {
        var summary = VarianceRules.Summarize([
            M("Sale", -200m), M("SaleVoid", 200m), M("Waste", -40m), M("WasteReversed", 40m)]);

        summary.TheoreticalUsage.ShouldBe(0m);
        summary.Waste.ShouldBe(0m);
        summary.Variance.ShouldBe(0m);
        summary.VariancePercent.ShouldBeNull();
    }

    [Fact]
    public void Summarize_CountFindsMore_IsNegativeVariance()
    {
        var summary = VarianceRules.Summarize([M("Sale", -100m), M("Count", 10m)]);

        summary.Variance.ShouldBe(-10m);
        summary.VariancePercent.ShouldBe(-10m);
    }

    [Fact]
    public void Summarize_CorrectionWithoutACost_LeavesValueBlank()
    {
        VarianceRules.Summarize([M("Sale", -100m), M("Count", -5m)]).VarianceValue.ShouldBeNull();
        VarianceRules.Summarize([M("Sale", -100m)]).VarianceValue.ShouldBeNull();
    }

    [Fact]
    public void Status_NotCountedOkAndCheck()
    {
        VarianceRules.Status(VarianceRules.Summarize([M("Sale", -100m)]), 5m).ShouldBe("Not counted");
        VarianceRules.Status(VarianceRules.Summarize([M("Sale", -100m), M("Count", 0m)]), 5m).ShouldBe("OK");
        VarianceRules.Status(VarianceRules.Summarize([M("Sale", -100m), M("Count", -5m)]), 5m).ShouldBe("OK");
        VarianceRules.Status(VarianceRules.Summarize([M("Sale", -100m), M("Count", -6m)]), 5m).ShouldBe("Check");
        VarianceRules.Status(VarianceRules.Summarize([M("Count", -6m)]), 5m).ShouldBe("Check");
    }
}
