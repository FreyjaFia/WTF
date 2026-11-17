using System.Text.RegularExpressions;
using WTF.Api.Features.Subscriptions;
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

    // Words added by a later script. The 20261130 script is a record of what it did and is never edited, so it knows only the
    // words that existed then; each later script is checked below.
    private static readonly string[] AddedLater = [PlanFeatures.Kitchen, PlanFeatures.Branches];

    private static string[] WordsOf20261130() => [.. PlanFeatures.Gateable.Except(AddedLater)];

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
    public void EveryCatalogKey_HasLabelDescriptionAndGroupText()
    {
        foreach (var key in PlanFeatures.Gateable)
        {
            PlanFeatureCatalog.HasText(key).ShouldBeTrue(key);
        }

        PlanFeatureCatalog.Entries.Select(e => e.Key).ShouldBe(PlanFeatures.Gateable);
        PlanFeatureCatalog.Entries.ShouldAllBe(e => e.Label != "" && e.Description != "" && e.Group != "");
    }

    [Fact]
    public void TheScriptHeader_ListsTheCatalogKeys()
    {
        var match = HeaderWords().Match(Script());
        match.Success.ShouldBeTrue("the script header no longer names the valid words");

        var listed = Words(match.Groups["words"].Value.Replace("--", " "));

        listed.ShouldBe(WordsOf20261130());
    }

    [Fact]
    public void TheBusinessPlanTheScriptInserts_HoldsEveryCatalogFeature()
    {
        var match = BusinessInsert().Match(Script());
        match.Success.ShouldBeTrue();

        Words(match.Groups["features"].Value).Order().ShouldBe(WordsOf20261130().Order());
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

    [Fact]
    public void TheKitchenScript_NamesEveryCatalogKey_AndGivesProAndBusinessTheKitchenWord()
    {
        var script = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sql", "20261210_add_kitchen_board.sql"));
        var header = Regex.Match(script, @"valid plan feature words are now:\s*(?<words>[a-z,\s\-]+?)\.", RegexOptions.Singleline);
        header.Success.ShouldBeTrue("the script header no longer names the valid words");

        Words(header.Groups["words"].Value.Replace("--", " ")).ShouldBe(PlanFeatures.Gateable);
        script.ShouldContain("WHERE Code IN ('pro', 'business')");
        script.ShouldContain("'kitchen'");
    }
}
