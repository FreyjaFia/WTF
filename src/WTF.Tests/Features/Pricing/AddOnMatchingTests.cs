using WTF.Api.Features.Promotions;
using static WTF.Tests.Features.Pricing.PricingCopies;

namespace WTF.Tests.Features.Pricing;

public class AddOnMatchingTests
{
    public static IEnumerable<object[]> Copies() => CopyNames.Select(c => new object[] { c });

    public static IEnumerable<object[]> OrderCopies() => new[] { "Create", "Update" }.Select(c => new object[] { c });

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_SameAddOnAndQuantity_ReturnsTrue(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 2)], [(AddOnA, 2)]).ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_NoRequiredAddOns_ReturnsFalse(string copy)
    {
        SatisfiesExact(copy, [], []).ShouldBeFalse();
        SatisfiesExact(copy, [(AddOnA, 1)], []).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_QuantityTooLow_ReturnsFalse(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 1)], [(AddOnA, 2)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_QuantityTooHigh_ReturnsFalse(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 3)], [(AddOnA, 2)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_MissingRequiredAddOn_ReturnsFalse(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 1)], [(AddOnA, 1), (AddOnB, 1)]).ShouldBeFalse();
        SatisfiesExact(copy, [], [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_ExtraAddOn_ReturnsFalse(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 1), (AddOnB, 1)], [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_ExtraAddOnWithZeroQuantity_IsIgnored(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 1), (AddOnB, 0)], [(AddOnA, 1)]).ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_OrderIndependent(string copy)
    {
        SatisfiesExact(copy, [(AddOnB, 2), (AddOnA, 1)], [(AddOnA, 1), (AddOnB, 2)]).ShouldBeTrue();
        SatisfiesExact(copy, [(AddOnA, 1), (AddOnB, 2)], [(AddOnB, 2), (AddOnA, 1)]).ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(Copies))]
    public void SatisfiesExactAddOns_RepeatedCartEntries_AreSummed(string copy)
    {
        SatisfiesExact(copy, [(AddOnA, 1), (AddOnA, 1)], [(AddOnA, 2)]).ShouldBeTrue();
        SatisfiesExact(copy, [(AddOnA, 1), (AddOnA, 1)], [(AddOnA, 1)]).ShouldBeFalse();
    }

    [Fact]
    public void SatisfiesExactAddOns_AllCopies_AgreeOnEveryCombination()
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
            var create = SatisfiesExact("Create", cart, req);
            SatisfiesExact("Update", cart, req).ShouldBe(create);
            SatisfiesExact("Evaluate", cart, req).ShouldBe(create);
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

    // ---- GetDiscountedUnitPrice (Create / Update) ----

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_ProductWithoutRules_ReturnsNull(string copy)
    {
        GetDiscounted(copy, 100m, [(AddOnA, 1)]).ShouldBeNull();
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_NoRuleMatchesAddOns_ReturnsNull(string copy)
    {
        GetDiscounted(copy, 100m, [(AddOnA, 1)], new RuleSpec(null, 10m, (AddOnB, 1))).ShouldBeNull();
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_MatchingRule_ReturnsPriceAndPercentLabel(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)], new RuleSpec(null, 10m, (AddOnA, 1)));
        r.ShouldNotBeNull();
        r.Value.Price.ShouldBe(90m);
        r.Value.Label.ShouldBe("Promo -10%");
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_FixedRule_UsesPesoLabel(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)], new RuleSpec(25m, null, (AddOnA, 1)));
        r.ShouldNotBeNull();
        r.Value.Price.ShouldBe(75m);
        r.Value.Label.ShouldBe("Promo -₱25.00");
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_FixedAndPercent_LabelFollowsFixed(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)], new RuleSpec(5m, 50m, (AddOnA, 1)));
        r.ShouldNotBeNull();
        r.Value.Price.ShouldBe(95m);
        r.Value.Label.ShouldBe("Promo -₱5.00");
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_FractionalPercent_LabelTrimsTrailingZeros(string copy)
    {
        GetDiscounted(copy, 100m, [(AddOnA, 1)], new RuleSpec(null, 12.5m, (AddOnA, 1)))!.Value.Label.ShouldBe("Promo -12.5%");
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_SeveralMatchingRules_PicksLowestPrice(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)],
            new RuleSpec(null, 10m, (AddOnA, 1)),
            new RuleSpec(null, 40m, (AddOnA, 1)),
            new RuleSpec(null, 20m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(60m);
        r.Value.Label.ShouldBe("Promo -40%");
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_TiedRules_KeepsFirst(string copy)
    {
        // 20 fixed and 20% off 100 both give 80; the first rule listed wins.
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)],
            new RuleSpec(20m, null, (AddOnA, 1)),
            new RuleSpec(null, 20m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(80m);
        r.Value.Label.ShouldBe("Promo -₱20.00");
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_NonMatchingCheaperRule_IsIgnored(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)],
            new RuleSpec(null, 90m, (AddOnB, 1)),
            new RuleSpec(null, 10m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(90m);
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_RuleWithoutValue_IsSkipped(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1)],
            new RuleSpec(null, null, (AddOnA, 1)),
            new RuleSpec(null, 10m, (AddOnA, 1)));
        r!.Value.Price.ShouldBe(90m);
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_RuleWithoutAddOns_NeverApplies(string copy)
    {
        // Pins current behaviour: SatisfiesExactAddOns returns false for an empty requirement list,
        // so a discounted-product rule with no add-ons can never match (even a cart with no add-ons).
        GetDiscounted(copy, 100m, [], new RuleSpec(null, 10m)).ShouldBeNull();
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_RepeatedCartAddOns_AreSummedBeforeMatching(string copy)
    {
        var r = GetDiscounted(copy, 100m, [(AddOnA, 1), (AddOnA, 1)], new RuleSpec(null, 10m, (AddOnA, 2)));
        r!.Value.Price.ShouldBe(90m);
    }

    [Theory]
    [MemberData(nameof(OrderCopies))]
    public void GetDiscountedUnitPrice_ExtraCartAddOn_Blocks(string copy)
    {
        GetDiscounted(copy, 100m, [(AddOnA, 1), (AddOnB, 1)], new RuleSpec(null, 10m, (AddOnA, 1))).ShouldBeNull();
    }

    [Fact]
    public void GetDiscountedUnitPrice_CreateAndUpdate_AgreeOnEveryScenario()
    {
        (Guid, int)[][] carts = [[], [(AddOnA, 1)], [(AddOnA, 1), (AddOnB, 1)], [(AddOnB, 2)]];
        RuleSpec[][] ruleSets =
        [
            [],
            [new RuleSpec(null, 10m, (AddOnA, 1))],
            [new RuleSpec(5m, null, (AddOnA, 1)), new RuleSpec(null, 50m, (AddOnB, 2))],
            [new RuleSpec(20m, 20m, (AddOnA, 1), (AddOnB, 1)), new RuleSpec(null, 33.33m, (AddOnA, 1))],
            [new RuleSpec(null, null, (AddOnA, 1))]
        ];

        foreach (var cart in carts)
        foreach (var rules in ruleSets)
        {
            var create = GetDiscounted("Create", 79.99m, cart, rules);
            var update = GetDiscounted("Update", 79.99m, cart, rules);
            update.ShouldBe(create);
        }
    }
}
