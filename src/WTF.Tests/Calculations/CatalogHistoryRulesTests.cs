using WTF.Calculations.Catalog;

namespace WTF.Tests.Calculations;

public class CatalogHistoryRulesTests
{
    private static readonly DateTime T0 = new(2026, 11, 1, 8, 0, 0, DateTimeKind.Utc);

    private static CatalogFieldChange Change(int hours, string? oldValue, string? newValue, int seconds = 0) =>
        new(T0.AddHours(hours), T0.AddHours(hours).AddSeconds(seconds), oldValue, newValue);

    [Fact]
    public void ValueAsOf_NoLaterChange_IsTheCurrentValue()
    {
        CatalogHistoryRules.ValueAsOf("120.00", [Change(-5, "100.00", "120.00")], T0).ShouldBe("120.00");
    }

    [Fact]
    public void ValueAsOf_TakesTheOldValueOfTheFirstChangeAfterTheTime()
    {
        var changes = new[] { Change(1, "100.00", "110.00"), Change(3, "110.00", "130.00"), Change(5, "130.00", "150.00") };

        CatalogHistoryRules.ValueAsOf("150.00", changes, T0).ShouldBe("100.00");
        CatalogHistoryRules.ValueAsOf("150.00", changes, T0.AddHours(2)).ShouldBe("110.00");
        CatalogHistoryRules.ValueAsOf("150.00", changes, T0.AddHours(4)).ShouldBe("130.00");
    }

    [Fact]
    public void ValueAsOf_AChangeAtExactlyTheTimeAlreadyApplies()
    {
        CatalogHistoryRules.ValueAsOf("110.00", [Change(1, "100.00", "110.00")], T0.AddHours(1)).ShouldBe("110.00");
    }

    [Fact]
    public void ValueAsOf_SameMomentTwice_UsesTheEarlierSavedRow()
    {
        var changes = new[] { Change(1, "110.00", "120.00", seconds: 2), Change(1, "100.00", "110.00", seconds: 1) };

        CatalogHistoryRules.ValueAsOf("120.00", changes, T0).ShouldBe("100.00");
    }

    [Fact]
    public void ValueAsOf_BeforeTheFieldExisted_IsNull()
    {
        CatalogHistoryRules.ValueAsOf("5.00", [Change(1, null, "5.00")], T0).ShouldBeNull();
    }

    [Fact]
    public void Between_IsOpenAtTheStartAndClosedAtTheEnd()
    {
        var changes = new[] { Change(0, "a", "b"), Change(1, "b", "c"), Change(2, "c", "d"), Change(3, "d", "e") };

        var found = CatalogHistoryRules.Between(changes, c => c.EffectiveFrom, T0, T0.AddHours(2));

        found.Select(c => c.NewValue).ShouldBe(["c", "d"]);
    }

    [Fact]
    public void Diff_ListsOnlyFieldsThatDiffer_InFieldOrder()
    {
        var before = new Dictionary<string, string?> { ["Price"] = "10.00", ["IsActive"] = "true", ["Gone"] = "x" };
        var after = new Dictionary<string, string?> { ["Price"] = "12.00", ["IsActive"] = "true", ["New"] = "y" };

        var diffs = CatalogHistoryRules.Diff(before, after);

        diffs.Select(d => (d.Field, d.OldValue, d.NewValue)).ShouldBe(
        [
            ("Gone", "x", null),
            ("New", null, "y"),
            ("Price", "10.00", "12.00"),
        ]);
    }

    [Fact]
    public void Diff_NothingChanged_IsEmpty()
    {
        var same = new Dictionary<string, string?> { ["Price"] = "10.00" };

        CatalogHistoryRules.Diff(same, new Dictionary<string, string?>(same)).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(100, "100.00")]
    [InlineData(100.5, "100.50")]
    [InlineData(12.345, "12.345")]
    public void Format_Decimal_IsInvariantAndKeepsTwoPlaces(double value, string expected)
    {
        CatalogHistoryRules.Format((decimal)value).ShouldBe(expected);
        CatalogHistoryRules.ParseDecimal(expected).ShouldBe((decimal)value);
    }

    [Fact]
    public void Format_Booleans_AreLowerCaseAndRoundTrip()
    {
        CatalogHistoryRules.Format(true).ShouldBe("true");
        CatalogHistoryRules.Format((bool?)null).ShouldBeNull();
        CatalogHistoryRules.ParseBool("false").ShouldBe(false);
    }

    [Fact]
    public void AddOnOverrideKey_IsStableAndDependsOnTheOrderOfTheTwoIds()
    {
        var product = Guid.NewGuid();
        var addOn = Guid.NewGuid();

        CatalogHistoryRules.AddOnOverrideKey(product, addOn).ShouldBe(CatalogHistoryRules.AddOnOverrideKey(product, addOn));
        CatalogHistoryRules.AddOnOverrideKey(product, addOn).ShouldNotBe(CatalogHistoryRules.AddOnOverrideKey(addOn, product));
    }

    [Fact]
    public void CoversSince_NeedsACreatedRowOrABaselineNotAfterTheTime()
    {
        CatalogHistoryRules.CoversSince(false, null, T0).ShouldBeFalse();
        CatalogHistoryRules.CoversSince(false, T0.AddHours(1), T0).ShouldBeFalse();
        CatalogHistoryRules.CoversSince(false, T0, T0).ShouldBeTrue();
        CatalogHistoryRules.CoversSince(true, null, T0).ShouldBeTrue();
    }
}
