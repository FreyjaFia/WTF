using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class WasteRulesFixesTests
{
    [Fact]
    public void TotalQuantity_SingleUnit_AddsQuantities()
    {
        var total = WasteRules.TotalQuantity(
        [
            new WasteEntry(100m, "ml", false),
            new WasteEntry(50.5m, "ML ", true)
        ]);

        total.ShouldBe(150.5m);
    }

    [Fact]
    public void TotalQuantity_MixedUnits_IsNull()
    {
        var total = WasteRules.TotalQuantity(
        [
            new WasteEntry(100m, "ml", false),
            new WasteEntry(2m, "pc", false)
        ]);

        total.ShouldBeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void TotalQuantity_UnknownUnit_IsNull(string? unit)
    {
        var total = WasteRules.TotalQuantity(
        [
            new WasteEntry(100m, "ml", false),
            new WasteEntry(5m, unit, false)
        ]);

        total.ShouldBeNull();
    }

    [Fact]
    public void TotalQuantity_NoEntries_IsZero()
    {
        WasteRules.TotalQuantity([]).ShouldBe(0m);
    }

    [Fact]
    public void Summarize_CountsDisputedSeparately()
    {
        var summary = WasteRules.Summarize(
        [
            new WasteEntry(100m, "ml", false),
            new WasteEntry(30m, "ml", true),
            new WasteEntry(20m, "ml", true)
        ]);

        summary.EntryCount.ShouldBe(3);
        summary.Quantity.ShouldBe(150m);
        summary.DisputedCount.ShouldBe(2);
        summary.DisputedQuantity.ShouldBe(50m);
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("  ml ", "ml")]
    [InlineData("pc", "pc")]
    public void NormalizeUnit_TrimsAndTreatsNullAsEmpty(string? unit, string expected)
    {
        WasteRules.NormalizeUnit(unit).ShouldBe(expected);
    }

    [Theory]
    [InlineData("ml", "ML", true)]
    [InlineData(" ml", "ml ", true)]
    [InlineData("ml", "g", false)]
    [InlineData(null, "", true)]
    public void SameUnit_IgnoresCaseAndSpaces(string? left, string? right, bool expected)
    {
        WasteRules.SameUnit(left, right).ShouldBe(expected);
    }

    [Fact]
    public void HasSingleUnit_DetectsMixedUnits()
    {
        WasteRules.HasSingleUnit(["ml", "ML", " ml"]).ShouldBeTrue();
        WasteRules.HasSingleUnit(["ml", "g"]).ShouldBeFalse();
        WasteRules.HasSingleUnit([]).ShouldBeTrue();
    }
}
