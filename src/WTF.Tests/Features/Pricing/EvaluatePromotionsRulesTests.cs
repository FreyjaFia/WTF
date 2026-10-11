using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Pricing.PricingCopies;

namespace WTF.Tests.Features.Pricing;

public class EvaluatePromotionsRulesTests
{
    private static readonly Guid ProdA = new("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid ProdB = new("aaaaaaaa-0000-0000-0000-000000000002");

    // ---- builders ----

    private static Promotion BundlePromo(decimal bundlePrice, params (Guid Product, int Qty, (Guid AddOn, int Qty)[] AddOns)[] items)
    {
        var promo = new Promotion { Id = Guid.NewGuid(), Name = "Bundle", TypeId = PromotionTypeIds.FixedBundle, IsActive = true };
        var bundle = new FixedBundlePromotion { PromotionId = promo.Id, BundlePrice = bundlePrice };
        foreach (var (product, qty, addOns) in items)
        {
            var item = new FixedBundlePromotionItem { Id = Guid.NewGuid(), FixedBundlePromotionId = promo.Id, ProductId = product, Quantity = qty };
            foreach (var (addOn, aq) in addOns)
            {
                item.FixedBundlePromotionItemAddOns.Add(new FixedBundlePromotionItemAddOn { Id = Guid.NewGuid(), AddOnProductId = addOn, Quantity = aq });
            }
            bundle.FixedBundlePromotionItems.Add(item);
        }
        promo.FixedBundlePromotion = bundle;
        return promo;
    }

    private static Promotion DiscountPromo(Guid product, decimal? fixedPrice, decimal? percent, params (Guid AddOn, int Qty)[] addOns)
    {
        var promo = new Promotion { Id = Guid.NewGuid(), Name = "Disc", TypeId = PromotionTypeIds.DiscountedProduct, IsActive = true };
        var item = new DiscountedProductPromotion
        {
            Id = Guid.NewGuid(), PromotionId = promo.Id, ProductId = product, FixedPrice = fixedPrice, PercentOff = percent
        };
        foreach (var (addOn, qty) in addOns)
        {
            item.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn { Id = Guid.NewGuid(), AddOnProductId = addOn, Quantity = qty });
        }
        promo.DiscountedProductPromotions.Add(item);
        return promo;
    }

    private static (Guid, int)[] None => [];

    private static List<PromotionCartLineDto> Run(List<PromotionCartLineDto> lines, params Promotion[] promos)
    {
        var generated = new List<PromotionCartLineDto>();
        EvaluatePromotionsHandler.ApplyFixedBundles(lines, generated, promos);
        return generated;
    }

    // ---- CalculateDiscountedUnitPrice / Clone ----

    [Fact]
    public void Clone_CopiesEveryField_AndDeepCopiesAddOns()
    {
        var original = Line([(AddOnA, 2)], ProdA, 3, 12.5m, "L1");
        original.IsPromoLine = true;
        original.IsFreeItem = true;
        original.BundleParentId = "parent";
        original.TriggerLineId = "trigger";
        original.PromotionId = Guid.NewGuid();
        original.IsLocked = true;

        var clone = EvaluatePromotionsHandler.Clone(original);

        clone.ShouldNotBeSameAs(original);
        clone.LineId.ShouldBe("L1");
        clone.ProductId.ShouldBe(ProdA);
        clone.Quantity.ShouldBe(3);
        clone.UnitPrice.ShouldBe(12.5m);
        clone.IsPromoLine.ShouldBeTrue();
        clone.IsFreeItem.ShouldBeTrue();
        clone.BundleParentId.ShouldBe("parent");
        clone.TriggerLineId.ShouldBe("trigger");
        clone.PromotionId.ShouldBe(original.PromotionId);
        clone.IsLocked.ShouldBeTrue();

        clone.AddOns.ShouldNotBeSameAs(original.AddOns);
        clone.AddOns.Count.ShouldBe(1);
        clone.AddOns[0].ShouldNotBeSameAs(original.AddOns[0]);
        clone.AddOns[0].AddOnProductId.ShouldBe(AddOnA);
        clone.AddOns[0].Quantity.ShouldBe(2);

        clone.AddOns[0].Quantity = 99;
        clone.Quantity = 0;
        original.AddOns[0].Quantity.ShouldBe(2);
        original.Quantity.ShouldBe(3);
    }

    // ---- ConsumeQuantity ----

    [Fact]
    public void ConsumeQuantity_EnoughInOneLine_ReducesIt()
    {
        var line = Line(null, ProdA, 5);
        var lines = new List<PromotionCartLineDto> { line };

        var trigger = EvaluatePromotionsHandler.ConsumeQuantity(lines, ProdA, 2, []);

        trigger.ShouldBeSameAs(line);
        line.Quantity.ShouldBe(3);
        lines.ShouldHaveSingleItem();
    }

    [Fact]
    public void ConsumeQuantity_ConsumesAllOfLine_RemovesIt()
    {
        var lines = new List<PromotionCartLineDto> { Line(null, ProdA, 2) };

        EvaluatePromotionsHandler.ConsumeQuantity(lines, ProdA, 2, []).ShouldNotBeNull();

        lines.ShouldBeEmpty();
    }

    [Fact]
    public void ConsumeQuantity_SpansLines_LargestFirst_AndReturnsLargestAsTrigger()
    {
        var small = Line(null, ProdA, 1, id: "small");
        var big = Line(null, ProdA, 3, id: "big");
        var lines = new List<PromotionCartLineDto> { small, big };

        var trigger = EvaluatePromotionsHandler.ConsumeQuantity(lines, ProdA, 4, []);

        trigger.ShouldBeSameAs(big);
        lines.ShouldBeEmpty();
    }

    [Fact]
    public void ConsumeQuantity_NotEnough_ReturnsNull_ButStillConsumesWhatItCould()
    {
        // Pins current behaviour: a failed consume is not rolled back.
        var line = Line(null, ProdA, 2);
        var lines = new List<PromotionCartLineDto> { line };

        EvaluatePromotionsHandler.ConsumeQuantity(lines, ProdA, 5, []).ShouldBeNull();

        lines.ShouldBeEmpty();
    }

    [Fact]
    public void ConsumeQuantity_OnlyMatchesProductAndAddOns()
    {
        var other = Line(null, ProdB, 5);
        var noAddOn = Line(null, ProdA, 5);
        var withAddOn = Line([(AddOnA, 1)], ProdA, 2);
        var lines = new List<PromotionCartLineDto> { other, noAddOn, withAddOn };

        var trigger = EvaluatePromotionsHandler.ConsumeQuantity(lines, ProdA, 2, [(AddOnA, 1)]);

        trigger.ShouldBeSameAs(withAddOn);
        other.Quantity.ShouldBe(5);
        noAddOn.Quantity.ShouldBe(5);
        lines.Count.ShouldBe(2);
    }

    // ---- ApplyFixedBundles ----

    [Fact]
    public void ApplyFixedBundles_SingleBundle_GeneratesParentAndChildAndConsumesLine()
    {
        var line = Line(null, ProdA, 1, 50m, "cart1");
        var lines = new List<PromotionCartLineDto> { line };
        var promo = BundlePromo(80m, (ProdA, 1, None));

        var generated = Run(lines, promo);

        lines.ShouldBeEmpty();
        generated.Count.ShouldBe(2);
        var parent = generated[0];
        var child = generated[1];

        parent.UnitPrice.ShouldBe(80m);
        parent.Quantity.ShouldBe(1);
        parent.ProductId.ShouldBe(ProdA);
        parent.BundleParentId.ShouldBeNull();
        parent.TriggerLineId.ShouldBe("cart1");
        parent.IsPromoLine.ShouldBeTrue();
        parent.IsLocked.ShouldBeTrue();
        parent.IsFreeItem.ShouldBeFalse();
        parent.PromotionId.ShouldBe(promo.Id);
        parent.AddOns.ShouldBeEmpty();

        child.UnitPrice.ShouldBe(0m);
        child.Quantity.ShouldBe(1);
        child.BundleParentId.ShouldBe(parent.LineId);
        child.TriggerLineId.ShouldBe("cart1");
        child.IsPromoLine.ShouldBeTrue();
        child.IsLocked.ShouldBeTrue();
        child.PromotionId.ShouldBe(promo.Id);
        child.LineId.ShouldNotBe(parent.LineId);
    }

    [Fact]
    public void ApplyFixedBundles_RepeatedBundle_GeneratesOneGroupPerCompleteBundle()
    {
        var line = Line(null, ProdA, 7, 50m);
        var lines = new List<PromotionCartLineDto> { line };
        var promo = BundlePromo(80m, (ProdA, 2, None));

        var generated = Run(lines, promo);

        // 7 / 2 = 3 bundles, 1 leftover.
        generated.Count(g => g.BundleParentId is null).ShouldBe(3);
        generated.Count(g => g.BundleParentId is not null).ShouldBe(3);
        generated.Where(g => g.BundleParentId is null).ShouldAllBe(g => g.UnitPrice == 80m && g.Quantity == 1);
        generated.Where(g => g.BundleParentId is not null).ShouldAllBe(g => g.UnitPrice == 0m && g.Quantity == 2);
        generated.Select(g => g.LineId).Distinct().Count().ShouldBe(6);
        lines.ShouldHaveSingleItem().Quantity.ShouldBe(1);
    }

    [Fact]
    public void ApplyFixedBundles_EachChildPointsAtItsOwnParent()
    {
        var lines = new List<PromotionCartLineDto> { Line(null, ProdA, 3) };

        var generated = Run(lines, BundlePromo(10m, (ProdA, 1, None)));

        var parents = generated.Where(g => g.BundleParentId is null).Select(g => g.LineId).ToList();
        var children = generated.Where(g => g.BundleParentId is not null).ToList();
        children.Select(c => c.BundleParentId!).OrderBy(x => x).ShouldBe(parents.OrderBy(x => x));
    }

    [Fact]
    public void ApplyFixedBundles_MultiItemBundle_LimitedByScarcestProduct()
    {
        var a = Line(null, ProdA, 3, id: "a");
        var b = Line(null, ProdB, 5, id: "b");
        var lines = new List<PromotionCartLineDto> { a, b };
        var promo = BundlePromo(100m, (ProdA, 1, None), (ProdB, 2, None));

        var generated = Run(lines, promo);

        // A allows 3, B allows 2 -> 2 bundles.
        generated.Count(g => g.BundleParentId is null).ShouldBe(2);
        generated.Count(g => g.ProductId == ProdA && g.BundleParentId is not null).ShouldBe(2);
        generated.Count(g => g.ProductId == ProdB && g.BundleParentId is not null).ShouldBe(2);
        a.Quantity.ShouldBe(1);
        b.Quantity.ShouldBe(1);
    }

    [Fact]
    public void ApplyFixedBundles_MultiItemBundle_ParentIsFirstItemAndEachChildTriggeredByItsLine()
    {
        var a = Line(null, ProdA, 1, id: "a");
        var b = Line(null, ProdB, 2, id: "b");
        var lines = new List<PromotionCartLineDto> { a, b };

        var generated = Run(lines, BundlePromo(100m, (ProdA, 1, None), (ProdB, 2, None)));

        generated.Count.ShouldBe(3);
        generated[0].ProductId.ShouldBe(ProdA);
        generated[0].UnitPrice.ShouldBe(100m);
        generated[0].TriggerLineId.ShouldBe("a");
        generated[1].ProductId.ShouldBe(ProdA);
        generated[1].TriggerLineId.ShouldBe("a");
        generated[2].ProductId.ShouldBe(ProdB);
        generated[2].Quantity.ShouldBe(2);
        generated[2].TriggerLineId.ShouldBe("b");
        generated.Skip(1).ShouldAllBe(g => g.BundleParentId == generated[0].LineId);
        lines.ShouldBeEmpty();
    }

    [Fact]
    public void ApplyFixedBundles_PartialBundle_LeavesCartUntouched()
    {
        var a = Line(null, ProdA, 5);
        var lines = new List<PromotionCartLineDto> { a };

        var generated = Run(lines, BundlePromo(100m, (ProdA, 1, None), (ProdB, 1, None)));

        generated.ShouldBeEmpty();
        a.Quantity.ShouldBe(5);
        lines.Count.ShouldBe(1);
    }

    [Fact]
    public void ApplyFixedBundles_QuantityBelowRequirement_LeavesCartUntouched()
    {
        var a = Line(null, ProdA, 2);
        var lines = new List<PromotionCartLineDto> { a };

        Run(lines, BundlePromo(100m, (ProdA, 3, None))).ShouldBeEmpty();

        a.Quantity.ShouldBe(2);
    }

    [Fact]
    public void ApplyFixedBundles_QuantitySplitAcrossLines_IsPooled()
    {
        var l1 = Line(null, ProdA, 1, id: "l1");
        var l2 = Line(null, ProdA, 1, id: "l2");
        var lines = new List<PromotionCartLineDto> { l1, l2 };

        var generated = Run(lines, BundlePromo(100m, (ProdA, 2, None)));

        generated.Count.ShouldBe(2);
        lines.ShouldBeEmpty();
    }

    [Fact]
    public void ApplyFixedBundles_EmptyCart_ReturnsNothing()
    {
        Run([], BundlePromo(100m, (ProdA, 1, None))).ShouldBeEmpty();
    }

    [Fact]
    public void ApplyFixedBundles_BundleWithoutItems_IsSkipped()
    {
        var a = Line(null, ProdA, 2);
        var lines = new List<PromotionCartLineDto> { a };

        Run(lines, BundlePromo(100m)).ShouldBeEmpty();
        Run(lines, new Promotion { Id = Guid.NewGuid(), TypeId = PromotionTypeIds.FixedBundle, FixedBundlePromotion = null }).ShouldBeEmpty();

        a.Quantity.ShouldBe(2);
    }

    [Fact]
    public void ApplyFixedBundles_RequiredAddOn_OnlyMatchingLinesAreUsed()
    {
        var plain = Line(null, ProdA, 5, id: "plain");
        var withAddOn = Line([(AddOnA, 1)], ProdA, 2, id: "addon");
        var lines = new List<PromotionCartLineDto> { plain, withAddOn };
        var promo = BundlePromo(100m, (ProdA, 1, [(AddOnA, 1)]));

        var generated = Run(lines, promo);

        generated.Count(g => g.BundleParentId is null).ShouldBe(2); // only 2 lines carry the add-on
        generated.ShouldAllBe(g => g.TriggerLineId == "addon");
        plain.Quantity.ShouldBe(5);
        lines.ShouldHaveSingleItem().ShouldBeSameAs(plain);
    }

    [Fact]
    public void ApplyFixedBundles_RequiredAddOnMissing_NoBundle()
    {
        var plain = Line(null, ProdA, 5);
        var lines = new List<PromotionCartLineDto> { plain };

        Run(lines, BundlePromo(100m, (ProdA, 1, [(AddOnA, 1)]))).ShouldBeEmpty();

        plain.Quantity.ShouldBe(5);
    }

    [Fact]
    public void ApplyFixedBundles_RequiredAddOnQuantityTooLow_NoBundle()
    {
        var line = Line([(AddOnA, 1)], ProdA, 2);
        var lines = new List<PromotionCartLineDto> { line };

        Run(lines, BundlePromo(100m, (ProdA, 1, [(AddOnA, 2)]))).ShouldBeEmpty();
    }

    [Fact]
    public void ApplyFixedBundles_LineWithExtraAddOns_StillMatches_AndChildCarriesOnlyRequiredAddOns()
    {
        // Bundles use "at least" matching (SatisfiesRequiredAddOns), unlike discounted products which are exact.
        var line = Line([(AddOnA, 3), (AddOnB, 1)], ProdA, 1, id: "x");
        var lines = new List<PromotionCartLineDto> { line };

        var generated = Run(lines, BundlePromo(100m, (ProdA, 1, [(AddOnA, 2)])));

        generated.Count.ShouldBe(2);
        var child = generated[1];
        child.AddOns.Count.ShouldBe(1);
        child.AddOns[0].AddOnProductId.ShouldBe(AddOnA);
        child.AddOns[0].Quantity.ShouldBe(2);
        generated[0].AddOns.ShouldBeEmpty();
    }

    [Fact]
    public void ApplyFixedBundles_FreeItemLines_AreNotCountedTowardsBundle()
    {
        var free = Line(null, ProdA, 3);
        free.IsFreeItem = true;
        var lines = new List<PromotionCartLineDto> { free };

        Run(lines, BundlePromo(100m, (ProdA, 1, None))).ShouldBeEmpty();

        free.Quantity.ShouldBe(3);
    }

    [Fact]
    public void ApplyFixedBundles_FreeAndPaidLineOfSameProduct_ConsumesPaidLine()
    {
        var free = Line(null, ProdA, 2, id: "free");
        free.IsFreeItem = true;
        var paid = Line(null, ProdA, 1, id: "paid");
        var lines = new List<PromotionCartLineDto> { free, paid };

        var generated = Run(lines, BundlePromo(100m, (ProdA, 1, None)));

        generated.ShouldAllBe(g => g.TriggerLineId == "paid");
        free.Quantity.ShouldBe(2);
    }

    [Fact]
    public void ApplyFixedBundles_LockedLines_AreNotExcludedByTheRule()
    {
        // Pins current behaviour: IsLocked is not checked by ApplyFixedBundles (locked promo lines are removed
        // earlier, in Handle, by the IsPromoLine filter). A locked non-promo line is consumed like any other.
        var locked = Line(null, ProdA, 1);
        locked.IsLocked = true;
        var lines = new List<PromotionCartLineDto> { locked };

        Run(lines, BundlePromo(100m, (ProdA, 1, None))).Count.ShouldBe(2);
    }

    [Fact]
    public void ApplyFixedBundles_TwoPromotions_ShareTheCartInOrder()
    {
        var a = Line(null, ProdA, 2);
        var lines = new List<PromotionCartLineDto> { a };
        var first = BundlePromo(10m, (ProdA, 1, None));
        var second = BundlePromo(20m, (ProdA, 1, None));

        var generated = Run(lines, first, second);

        generated.Count(g => g.BundleParentId is null && g.PromotionId == first.Id).ShouldBe(2);
        generated.Count(g => g.PromotionId == second.Id).ShouldBe(0);
        lines.ShouldBeEmpty();
    }

    // ---- ApplyDiscountedProducts ----

    private static PromotionCartLineDto Discounted(PromotionCartLineDto line, params Promotion[] promos)
    {
        EvaluatePromotionsHandler.ApplyDiscountedProducts([line], promos);
        return line;
    }

    [Fact]
    public void ApplyDiscountedProducts_PercentOff_ReducesUnitPriceAndSetsPromotionId()
    {
        var promo = DiscountPromo(ProdA, null, 25m, (AddOnA, 1));
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 2, 200m), promo);

        line.UnitPrice.ShouldBe(150m);
        line.PromotionId.ShouldBe(promo.Id);
        line.Quantity.ShouldBe(2);
    }

    [Fact]
    public void ApplyDiscountedProducts_FixedAmount_SubtractsFromUnitPrice()
    {
        var promo = DiscountPromo(ProdA, 30m, null, (AddOnA, 1));
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 100m), promo);

        line.UnitPrice.ShouldBe(70m);
        line.PromotionId.ShouldBe(promo.Id);
    }

    [Fact]
    public void ApplyDiscountedProducts_FixedAmountOverPrice_ClampsToZero()
    {
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 20m), DiscountPromo(ProdA, 50m, null, (AddOnA, 1)));

        line.UnitPrice.ShouldBe(0m);
    }

    [Fact]
    public void ApplyDiscountedProducts_DoesNotSplitQuantity_WholeLineGetsDiscountedPrice()
    {
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 5, 100m), DiscountPromo(ProdA, null, 10m, (AddOnA, 1)));

        line.Quantity.ShouldBe(5);
        line.UnitPrice.ShouldBe(90m);
    }

    [Fact]
    public void ApplyDiscountedProducts_AddOnsMustMatchExactly()
    {
        var promo = DiscountPromo(ProdA, null, 10m, (AddOnA, 1));

        Discounted(Line(null, ProdA, 1, 100m), promo).UnitPrice.ShouldBe(100m);                          // missing
        Discounted(Line([(AddOnA, 2)], ProdA, 1, 100m), promo).UnitPrice.ShouldBe(100m);                 // too many
        Discounted(Line([(AddOnA, 1), (AddOnB, 1)], ProdA, 1, 100m), promo).UnitPrice.ShouldBe(100m);    // extra add-on
        Discounted(Line([(AddOnA, 1)], ProdA, 1, 100m), promo).UnitPrice.ShouldBe(90m);                  // exact
    }

    [Fact]
    public void ApplyDiscountedProducts_NoMatch_LeavesPromotionIdUnset()
    {
        var line = Discounted(Line(null, ProdA, 1, 100m), DiscountPromo(ProdA, null, 10m, (AddOnA, 1)));

        line.PromotionId.ShouldBeNull();
    }

    [Fact]
    public void ApplyDiscountedProducts_PromotionForOtherProduct_IsIgnored()
    {
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 100m), DiscountPromo(ProdB, null, 50m, (AddOnA, 1)));

        line.UnitPrice.ShouldBe(100m);
        line.PromotionId.ShouldBeNull();
    }

    [Fact]
    public void ApplyDiscountedProducts_SeveralPromotions_PicksLowestPrice()
    {
        var weak = DiscountPromo(ProdA, null, 10m, (AddOnA, 1));
        var strong = DiscountPromo(ProdA, 60m, null, (AddOnA, 1));
        var mid = DiscountPromo(ProdA, null, 30m, (AddOnA, 1));
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 100m), weak, strong, mid);

        line.UnitPrice.ShouldBe(40m);
        line.PromotionId.ShouldBe(strong.Id);
    }

    [Fact]
    public void ApplyDiscountedProducts_TiedPromotions_KeepsFirst()
    {
        var first = DiscountPromo(ProdA, 20m, null, (AddOnA, 1));
        var second = DiscountPromo(ProdA, null, 20m, (AddOnA, 1));
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 100m), first, second);

        line.PromotionId.ShouldBe(first.Id);
    }

    [Fact]
    public void ApplyDiscountedProducts_PromotionWithoutValue_IsSkipped()
    {
        var empty = DiscountPromo(ProdA, null, null, (AddOnA, 1));
        var real = DiscountPromo(ProdA, null, 10m, (AddOnA, 1));
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 100m), empty, real);

        line.PromotionId.ShouldBe(real.Id);
        line.UnitPrice.ShouldBe(90m);
    }

    [Fact]
    public void ApplyDiscountedProducts_PromotionWithoutAddOns_NeverApplies()
    {
        // Pins current behaviour (SatisfiesExactAddOns returns false for an empty requirement list).
        var line = Discounted(Line(null, ProdA, 1, 100m), DiscountPromo(ProdA, null, 10m));

        line.UnitPrice.ShouldBe(100m);
        line.PromotionId.ShouldBeNull();
    }

    [Fact]
    public void ApplyDiscountedProducts_EachLineEvaluatedIndependently()
    {
        var promo = DiscountPromo(ProdA, null, 50m, (AddOnA, 1));
        var matching = Line([(AddOnA, 1)], ProdA, 1, 100m);
        var other = Line(null, ProdA, 1, 100m);

        EvaluatePromotionsHandler.ApplyDiscountedProducts([matching, other], [promo]);

        matching.UnitPrice.ShouldBe(50m);
        other.UnitPrice.ShouldBe(100m);
    }

    [Fact]
    public void ApplyDiscountedProducts_PercentRounding_RoundsAwayFromZero()
    {
        var line = Discounted(Line([(AddOnA, 1)], ProdA, 1, 10.01m), DiscountPromo(ProdA, null, 50m, (AddOnA, 1)));

        line.UnitPrice.ShouldBe(5.01m);
    }

    // ---- Handle (uses the in-memory db to cover the line / date filters) ----

    private static async Task<EvaluatePromotionsResponseDto> Evaluate(
        IEnumerable<Promotion> promos, List<PromotionCartLineDto> lines, DateTime? at = null)
    {
        var name = TestDb.NewName();
        await using (var seed = TestDb.Create(name))
        {
            foreach (var p in promos)
            {
                p.CreatedAt = new DateTime(2026, 1, 1);
                p.CreatedBy = Guid.NewGuid();
                seed.Promotions.Add(p);
            }
            await seed.SaveChangesAsync();
        }

        await using var db = TestDb.Create(name);
        var handler = new EvaluatePromotionsHandler(db, TestRequest.None());
        return await handler.Handle(
            new EvaluatePromotionsCommand(new EvaluatePromotionsRequestDto(lines, at ?? new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc))),
            CancellationToken.None);
    }

    [Fact]
    public async Task Handle_IgnoresPromoLinesAndZeroQuantityLines_AndDoesNotMutateRequest()
    {
        var real = Line(null, ProdA, 1, 10m, "real");
        var promoLine = Line(null, ProdA, 1, 0m, "promo");
        promoLine.IsPromoLine = true;
        var zero = Line(null, ProdB, 0, 10m, "zero");
        var request = new List<PromotionCartLineDto> { real, promoLine, zero };

        var result = await Evaluate([], request);

        result.Lines.Select(l => l.LineId).ShouldBe(["real"]);
        request.Count.ShouldBe(3);
        result.Lines[0].ShouldNotBeSameAs(real);
    }

    [Fact]
    public async Task Handle_AppliesBundleThenDiscount_AndRemainingLinesComeBeforeGenerated()
    {
        var bundle = BundlePromo(100m, (ProdA, 2, None));
        var discount = DiscountPromo(ProdB, null, 50m, (AddOnA, 1));
        var lines = new List<PromotionCartLineDto>
        {
            Line(null, ProdA, 3, 60m, "a"),
            Line([(AddOnA, 1)], ProdB, 1, 40m, "b")
        };

        var result = await Evaluate([bundle, discount], lines);

        result.Lines.Select(l => l.LineId).Take(2).ShouldBe(["a", "b"]);
        result.Lines[0].Quantity.ShouldBe(1);
        result.Lines[1].UnitPrice.ShouldBe(20m);
        result.Lines[1].PromotionId.ShouldBe(discount.Id);
        result.Lines.Skip(2).ShouldAllBe(l => l.IsPromoLine);
        result.Lines.Count.ShouldBe(4);
    }

    [Fact]
    public async Task Handle_InactivePromotion_IsNotApplied()
    {
        var bundle = BundlePromo(100m, (ProdA, 1, None));
        bundle.IsActive = false;

        var result = await Evaluate([bundle], [Line(null, ProdA, 1, 60m)]);

        result.Lines.ShouldHaveSingleItem().IsPromoLine.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_PromotionDateWindow_IsInclusiveOfStartAndEndCalendarDays()
    {
        var start = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2026, 6, 10, 0, 0, 0, DateTimeKind.Utc);

        async Task<int> Count(DateTime at)
        {
            var bundle = BundlePromo(100m, (ProdA, 1, None));
            bundle.StartDate = start;
            bundle.EndDate = end;
            var r = await Evaluate([bundle], [Line(null, ProdA, 1, 60m)], at);
            return r.Lines.Count(l => l.IsPromoLine);
        }

        // Start and end are whole calendar days (no time zone header here, so UTC days).
        (await Count(start.AddTicks(-1))).ShouldBe(0);
        (await Count(start)).ShouldBe(2);
        (await Count(end)).ShouldBe(2);
        (await Count(end.AddHours(23).AddMinutes(59))).ShouldBe(2); // still the last day
        (await Count(end.AddDays(1))).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_NoDateConstraints_AlwaysActive()
    {
        var r = await Evaluate([BundlePromo(100m, (ProdA, 1, None))], [Line(null, ProdA, 1, 60m)]);

        r.Lines.Count(l => l.IsPromoLine).ShouldBe(2);
    }
}
