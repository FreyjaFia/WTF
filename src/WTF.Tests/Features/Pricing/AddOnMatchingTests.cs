using WTF.Api.Features.Promotions;
using static WTF.Tests.Features.Pricing.PricingTestHelpers;

namespace WTF.Tests.Features.Pricing;

public class AddOnMatchingTests
{
    public static IEnumerable<object[]> ImplementationNames() => Implementations.Select(c => new object[] { c });

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_SameAddOnAndQuantity_ReturnsTrue(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 2)], [(AddOnA, 2)]).ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_NoRequiredAddOns_ReturnsFalse(string implementation)
    {
        SatisfiesExact(implementation, [], []).ShouldBeFalse();
        SatisfiesExact(implementation, [(AddOnA, 1)], []).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_QuantityTooLow_ReturnsFalse(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 1)], [(AddOnA, 2)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_QuantityTooHigh_ReturnsFalse(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 3)], [(AddOnA, 2)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_MissingRequiredAddOn_ReturnsFalse(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 1)], [(AddOnA, 1), (AddOnB, 1)]).ShouldBeFalse();
        SatisfiesExact(implementation, [], [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_ExtraAddOn_ReturnsFalse(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 1), (AddOnB, 1)], [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_ExtraAddOnWithZeroQuantity_IsIgnored(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 1), (AddOnB, 0)], [(AddOnA, 1)]).ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_OrderIndependent(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnB, 2), (AddOnA, 1)], [(AddOnA, 1), (AddOnB, 2)]).ShouldBeTrue();
        SatisfiesExact(implementation, [(AddOnA, 1), (AddOnB, 2)], [(AddOnB, 2), (AddOnA, 1)]).ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(ImplementationNames))]
    public void SatisfiesExactAddOns_RepeatedCartEntries_AreSummed(string implementation)
    {
        SatisfiesExact(implementation, [(AddOnA, 1), (AddOnA, 1)], [(AddOnA, 2)]).ShouldBeTrue();
        SatisfiesExact(implementation, [(AddOnA, 1), (AddOnA, 1)], [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Fact]
    public void SatisfiesExactAddOns_EvaluateWrapper_AgreesWithShared()
    {
        (Guid, int)[][] carts =
        [
            [], [(AddOnA, 1)], [(AddOnA, 2)], [(AddOnA, 1), (AddOnB, 1)], [(AddOnB, 1), (AddOnA, 1)],
            [(AddOnA, 1), (AddOnA, 1)], [(AddOnA, 1), (AddOnC, 0)], [(AddOnC, 1)], [(AddOnA, 1), (AddOnB, 2), (AddOnC, 3)]
        ];
        (Guid, int)[][] reqs =
        [
            [], [(AddOnA, 1)], [(AddOnA, 2)], [(AddOnA, 1), (AddOnB, 1)], [(AddOnB, 1)], [(AddOnA, 1), (AddOnB, 2), (AddOnC, 3)]
        ];

        foreach (var cart in carts)
        foreach (var req in reqs)
        {
            SatisfiesExact("Evaluate", cart, req).ShouldBe(SatisfiesExact("Shared", cart, req));
        }
    }

    // ---- SatisfiesRequiredAddOns (Evaluate only): "at least" semantics, unlike the exact match ----

    [Fact]
    public void SatisfiesRequiredAddOns_NoRequirements_ReturnsTrue()
    {
        EvaluatePromotionsHandler.SatisfiesRequiredAddOns(Line([(AddOnA, 1)]), []).ShouldBeTrue();
        EvaluatePromotionsHandler.SatisfiesRequiredAddOns(Line(), []).ShouldBeTrue();
    }

    [Fact]
    public void SatisfiesRequiredAddOns_ExtraAddOnsAndHigherQuantity_StillSatisfied()
    {
        EvaluatePromotionsHandler.SatisfiesRequiredAddOns(Line([(AddOnA, 3), (AddOnB, 1)]), [(AddOnA, 2)]).ShouldBeTrue();
    }

    [Fact]
    public void SatisfiesRequiredAddOns_LowerQuantityOrMissing_NotSatisfied()
    {
        EvaluatePromotionsHandler.SatisfiesRequiredAddOns(Line([(AddOnA, 1)]), [(AddOnA, 2)]).ShouldBeFalse();
        EvaluatePromotionsHandler.SatisfiesRequiredAddOns(Line([(AddOnB, 5)]), [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Fact]
    public void SatisfiesRequiredAddOns_RepeatedEntries_AreSummed()
    {
        EvaluatePromotionsHandler.SatisfiesRequiredAddOns(Line([(AddOnA, 1), (AddOnA, 1)]), [(AddOnA, 2)]).ShouldBeTrue();
    }

    // ---- GetDiscountedUnitPrice ----

    [Fact]
    public void GetDiscountedUnitPrice_ProductWithoutRules_ReturnsNull()
    {
        GetDiscounted(100m, [(AddOnA, 1)]).ShouldBeNull();
    }

    [Fact]
    public void GetDiscountedUnitPrice_NoRuleMatchesAddOns_ReturnsNull()
    {
        GetDiscounted(100m, [(AddOnA, 1)], new RuleSpec(null, 10m, (AddOnB, 1))).ShouldBeNull();
    }

    [Fact]
    public void GetDiscountedUnitPrice_MatchingRule_ReturnsPriceAndPercentLabel()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1)], new RuleSpec(null, 10m, (AddOnA, 1)));
        r.ShouldNotBeNull();
        r.Value.Price.ShouldBe(90m);
        r.Value.Label.ShouldBe("Promo -10%");
    }

    [Fact]
    public void GetDiscountedUnitPrice_FixedRule_UsesPesoLabel()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1)], new RuleSpec(25m, null, (AddOnA, 1)));
        r.ShouldNotBeNull();
        r.Value.Price.ShouldBe(75m);
        r.Value.Label.ShouldBe("Promo -₱25.00");
    }

    [Fact]
    public void GetDiscountedUnitPrice_FixedAndPercent_LabelFollowsFixed()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1)], new RuleSpec(5m, 50m, (AddOnA, 1)));
        r.ShouldNotBeNull();
        r.Value.Price.ShouldBe(95m);
        r.Value.Label.ShouldBe("Promo -₱5.00");
    }

    [Fact]
    public void GetDiscountedUnitPrice_FractionalPercent_LabelTrimsTrailingZeros()
    {
        GetDiscounted(100m, [(AddOnA, 1)], new RuleSpec(null, 12.5m, (AddOnA, 1)))!.Value.Label.ShouldBe("Promo -12.5%");
    }

    [Fact]
    public void GetDiscountedUnitPrice_SeveralMatchingRules_PicksLowestPrice()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1)],
            new RuleSpec(null, 10m, (AddOnA, 1)),
            new RuleSpec(null, 40m, (AddOnA, 1)),
            new RuleSpec(null, 20m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(60m);
        r.Value.Label.ShouldBe("Promo -40%");
    }

    [Fact]
    public void GetDiscountedUnitPrice_TiedRules_KeepsFirst()
    {
        // 20 fixed and 20% off 100 both give 80; the first rule listed wins.
        var r = GetDiscounted(100m, [(AddOnA, 1)],
            new RuleSpec(20m, null, (AddOnA, 1)),
            new RuleSpec(null, 20m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(80m);
        r.Value.Label.ShouldBe("Promo -₱20.00");
    }

    [Fact]
    public void GetDiscountedUnitPrice_NonMatchingCheaperRule_IsIgnored()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1)],
            new RuleSpec(null, 90m, (AddOnB, 1)),
            new RuleSpec(null, 10m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(90m);
    }

    [Fact]
    public void GetDiscountedUnitPrice_RuleWithoutValue_IsSkipped()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1)],
            new RuleSpec(null, null, (AddOnA, 1)),
            new RuleSpec(null, 10m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(90m);
    }

    [Fact]
    public void GetDiscountedUnitPrice_RuleWithoutAddOns_NeverApplies()
    {
        // Pins current behaviour: SatisfiesExactAddOns returns false for an empty requirement list,
        // so a discounted-product rule with no add-ons can never match (even a cart with no add-ons).
        GetDiscounted(100m, [], new RuleSpec(null, 10m)).ShouldBeNull();
    }

    [Fact]
    public void GetDiscountedUnitPrice_RepeatedCartAddOns_AreSummedBeforeMatching()
    {
        var r = GetDiscounted(100m, [(AddOnA, 1), (AddOnA, 1)], new RuleSpec(null, 10m, (AddOnA, 2)));
        r!.Value.Price.ShouldBe(90m);
    }

    [Fact]
    public void GetDiscountedUnitPrice_ExtraCartAddOn_Blocks()
    {
        GetDiscounted(100m, [(AddOnA, 1), (AddOnB, 1)], new RuleSpec(null, 10m, (AddOnA, 1))).ShouldBeNull();
    }
}
