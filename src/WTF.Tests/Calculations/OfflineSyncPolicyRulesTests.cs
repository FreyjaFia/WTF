using WTF.Calculations.Orders;

namespace WTF.Tests.Calculations;

public class OfflineSyncPolicyRulesTests
{
    private static OfflineSyncPolicySnapshot Policy(decimal tolerance = 0m, params string[] noteCodes) =>
        new(noteCodes.ToHashSet(StringComparer.Ordinal), tolerance, false, 2);

    [Fact]
    public void Defaults_MatchTodaysBehavior()
    {
        var policy = OfflineSyncPolicySnapshot.Default;

        policy.NoteCodes.ShouldBeEmpty();
        policy.PriceTolerance.ShouldBe(0m);
        policy.AutoApproveNotes.ShouldBeFalse();
        policy.AgedAfterDays.ShouldBe(2);
    }

    [Theory]
    [InlineData("PriceChanged")]
    [InlineData("AddOnPriceChanged")]
    [InlineData("ProductInactive")]
    [InlineData("BundleChanged")]
    [InlineData("CustomerInactive")]
    [InlineData("PromotionEnded")]
    [InlineData("UnknownProduct")]
    public void WithDefaults_EveryConfigurableHoldStaysHeld(string code)
    {
        OfflineSyncPolicyRules.StaysHold(code, true, 0.01m, OfflineSyncPolicySnapshot.Default).ShouldBeTrue();
    }

    [Fact]
    public void ZeroTolerance_NeverSoftensAPriceDifference()
    {
        OfflineSyncPolicyRules.StaysHold("PriceChanged", true, 0.01m, Policy(0m)).ShouldBeTrue();
        OfflineSyncPolicyRules.IsWithinTolerance(0m, 0m).ShouldBeFalse();
    }

    [Theory]
    [InlineData(3, 5, false)]
    [InlineData(5, 5, false)]
    [InlineData(5.01, 5, true)]
    [InlineData(6, 5, true)]
    public void Tolerance_SoftensADifferenceAtOrBelowIt(double difference, double tolerance, bool staysHold)
    {
        var policy = Policy((decimal)tolerance);

        OfflineSyncPolicyRules.StaysHold("PriceChanged", true, (decimal)difference, policy).ShouldBe(staysHold);
        OfflineSyncPolicyRules.StaysHold("AddOnPriceChanged", true, (decimal)difference, policy).ShouldBe(staysHold);
    }

    [Fact]
    public void Tolerance_OnlyAppliesToPriceCodes()
    {
        OfflineSyncPolicyRules.StaysHold("ProductInactive", true, 1m, Policy(50m)).ShouldBeTrue();
        OfflineSyncPolicyRules.StaysHold("BundleChanged", true, 1m, Policy(50m)).ShouldBeTrue();
    }

    [Fact]
    public void ANoteMode_SoftensThatCodeOnly()
    {
        var policy = Policy(0m, "CustomerInactive");

        OfflineSyncPolicyRules.StaysHold("CustomerInactive", true, null, policy).ShouldBeFalse();
        OfflineSyncPolicyRules.StaysHold("ProductInactive", true, null, policy).ShouldBeTrue();
    }

    [Theory]
    [InlineData("SeniorPwdSettingsChanged")]
    [InlineData("SeniorPwdDisabled")]
    [InlineData("SeniorPwdIdMissing")]
    [InlineData("SeniorPwdOnPromotion")]
    [InlineData("SeniorPwdPermissionLost")]
    public void SeniorPwdCodes_IgnoreTheWholePolicy(string code)
    {
        var loose = Policy(1000m, code, "PriceChanged");

        OfflineSyncPolicyRules.StaysHold(code, true, 1m, loose).ShouldBeTrue();
        OfflineSyncPolicyRules.IsSeniorPwdCode(code).ShouldBeTrue();
        OfflineSyncPolicyRules.IsConfigurable(code).ShouldBeFalse();
    }

    [Fact]
    public void ANoteNeverBecomesAHold()
    {
        OfflineSyncPolicyRules.StaysHold("SeniorPwdIdRepeated", false, null, Policy(0m)).ShouldBeFalse();
        OfflineSyncPolicyRules.StaysHold("PriceChanged", false, 99m, Policy(0m)).ShouldBeFalse();
    }

    [Theory]
    [InlineData("PromotionOverLimit")]
    [InlineData("StockShortfall")]
    public void CodesOutsideTheList_KeepTheSeverityTheReviewGave(string code)
    {
        OfflineSyncPolicyRules.StaysHold(code, true, null, Policy(1000m, code)).ShouldBeTrue();
        OfflineSyncPolicyRules.StaysHold(code, false, null, Policy(0m)).ShouldBeFalse();
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(1000, true)]
    [InlineData(1000.01, false)]
    [InlineData(-1, false)]
    public void Tolerance_IsValidFromZeroToAThousand(double tolerance, bool valid)
    {
        OfflineSyncPolicyRules.IsValidTolerance((decimal)tolerance).ShouldBe(valid);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(30, true)]
    [InlineData(31, false)]
    public void AgedAfterDays_IsValidFromOneToThirty(int days, bool valid)
    {
        OfflineSyncPolicyRules.IsValidAgedAfterDays(days).ShouldBe(valid);
    }

    [Fact]
    public void AnOrderIsAgedOnlyAfterTheLimit()
    {
        var held = new DateTime(2026, 11, 10, 8, 0, 0, DateTimeKind.Utc);

        OfflineSyncPolicyRules.IsAged(held, held.AddDays(2), 2).ShouldBeFalse();
        OfflineSyncPolicyRules.IsAged(held, held.AddDays(2).AddMinutes(1), 2).ShouldBeTrue();
    }
}
