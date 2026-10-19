using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class StockCoverageRulesTests
{
    private static CoverageGroup Sizes(params (string Name, bool Linked)[] options) =>
        new("Size", options.Select(o => new CoverageOption(o.Name, o.Linked)).ToList());

    [Fact]
    public void ProductLinked_IsCovered() =>
        StockCoverageRules.Evaluate(true, []).Coverage.ShouldBe(StockCoverage.Covered);

    [Fact]
    public void NothingLinkedAnywhere_IsMissing()
    {
        var result = StockCoverageRules.Evaluate(false, [Sizes(("Regular", false), ("Large", false))]);

        result.Coverage.ShouldBe(StockCoverage.Missing);
        result.MissingOptions.ShouldBeEmpty();
    }

    [Fact]
    public void NoLinkAndNoGroups_IsMissing() =>
        StockCoverageRules.Evaluate(false, []).Coverage.ShouldBe(StockCoverage.Missing);

    [Fact]
    public void EverySizeLinked_IsCoveredEvenWithoutAProductLink() =>
        StockCoverageRules.Evaluate(false, [Sizes(("Regular", true), ("Large", true))]).Coverage.ShouldBe(StockCoverage.Covered);

    [Fact]
    public void SomeSizesLinked_IsPartialAndNamesTheUnlinkedOnes()
    {
        var result = StockCoverageRules.Evaluate(false, [Sizes(("Regular", true), ("Large", false), ("Small", false))]);

        result.Coverage.ShouldBe(StockCoverage.Partial);
        result.MissingOptions.ShouldBe(["Size: Large", "Size: Small"]);
    }

    [Fact]
    public void ProductLinkedButOneSizeLeftOut_IsStillPartial()
    {
        var result = StockCoverageRules.Evaluate(true, [Sizes(("Regular", true), ("Large", false))]);

        result.Coverage.ShouldBe(StockCoverage.Partial);
        result.MissingOptions.ShouldBe(["Size: Large"]);
    }

    [Fact]
    public void ProductLinkedAndNoSizeLinked_IsCovered() =>
        StockCoverageRules.Evaluate(true, [Sizes(("Regular", false), ("Large", false))]).Coverage.ShouldBe(StockCoverage.Covered);

    [Fact]
    public void FlavorGroupsAreJudgedLikeSizeGroups()
    {
        var flavors = new CoverageGroup("Flavor", [new CoverageOption("Vanilla", true), new CoverageOption("Mocha", false)]);

        StockCoverageRules.Evaluate(false, [flavors]).MissingOptions.ShouldBe(["Flavor: Mocha"]);
    }

    [Fact]
    public void AnEmptyGroupIsIgnored() =>
        StockCoverageRules.Evaluate(true, [new CoverageGroup("Size", [])]).Coverage.ShouldBe(StockCoverage.Covered);
}
