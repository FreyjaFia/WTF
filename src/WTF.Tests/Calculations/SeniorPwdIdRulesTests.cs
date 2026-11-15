using WTF.Calculations.Orders;

namespace WTF.Tests.Calculations;

public class SeniorPwdIdRulesTests
{
    [Theory]
    [InlineData("  sc 123  ", "SC123")]
    [InlineData("SC-123", "SC-123")]
    [InlineData(null, "")]
    [InlineData("   ", "")]
    public void NormalizeIdNumber_TrimsDropsSpacesAndUpperCases(string? input, string expected)
    {
        SeniorPwdRules.NormalizeIdNumber(input).ShouldBe(expected);
    }

    [Theory]
    [InlineData("SC-123", "sc123")]
    [InlineData("SC 123", "SC-123")]
    public void IdKey_TreatsSpellingsOfOneCardAsTheSame(string a, string b)
    {
        SeniorPwdRules.IdKey(a).ShouldBe(SeniorPwdRules.IdKey(b));
    }
}
