using System.Text.RegularExpressions;
using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Calculations;

/// <summary>
/// The feature words live in four places: the catalog in WTF.Calculations, its copy in the POS (compared through
/// calculation-cases.json by SharedCasesTests and the Angular spec), the SQL script that seeds the plans, and the E2E
/// seed (which is built from the same constants). This compares the SQL copy, which cannot share code, with the catalog.
/// </summary>
public partial class PlanFeatureDriftTests
{
    private static readonly string[] LegacyWords = ["pos", "orders", "reports", "offline"];

    private static string Script() =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sql", "20261130_plan_feature_catalog.sql"));

    private static string[] Words(string text) =>
        text.Split([',', ' ', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    [GeneratedRegex(@"valid words now live in\s*--\s*code \(WTF\.Calculations PlanFeatures\):\s*(?<words>[a-z,\s\-]+?)\.", RegexOptions.Singleline)]
    private static partial Regex HeaderWords();

    [GeneratedRegex(@"VALUES \('business',[^']*'[^']*',\s*[0-9.]+,\s*'(?<features>[^']*)'")]
    private static partial Regex BusinessInsert();

    [GeneratedRegex(@"SET Features = '(?<features>[^']*)'")]
    private static partial Regex ProUpdate();

    [Fact]
    public void TheScriptHeader_ListsTheCatalogKeys()
    {
        var match = HeaderWords().Match(Script());
        match.Success.ShouldBeTrue("the script header no longer names the valid words");

        var listed = Words(match.Groups["words"].Value.Replace("--", " "));

        listed.ShouldBe(PlanFeatures.Gateable);
    }

    [Fact]
    public void TheBusinessPlanTheScriptInserts_HoldsEveryCatalogFeature()
    {
        var match = BusinessInsert().Match(Script());
        match.Success.ShouldBeTrue();

        Words(match.Groups["features"].Value).Order().ShouldBe(PlanFeatures.Gateable.Order());
    }

    [Fact]
    public void TheProPlanTheScriptSets_UsesOnlyKnownWords_AndAlreadyHoldsWhatItNeeds()
    {
        var match = ProUpdate().Match(Script());
        match.Success.ShouldBeTrue();

        var words = Words(match.Groups["features"].Value);
        var known = words.Except(LegacyWords).ToList();

        PlanFeatures.Unknown(known).ShouldBeEmpty();
        PlanFeatures.Normalize(known).Order().ShouldBe(known.Order());
    }
}
