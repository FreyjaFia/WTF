using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class StockDeductionRulesTests
{
    private static readonly Guid Milk = Guid.NewGuid();
    private static readonly Guid Cup = Guid.NewGuid();
    private static readonly Guid Latte = Guid.NewGuid();
    private static readonly Guid Mocha = Guid.NewGuid();
    private static readonly Guid Oat = Guid.NewGuid();

    private static StockLink[] Links =>
    [
        new(Latte, Milk, 200m),
        new(Latte, Cup, 1m),
        new(Mocha, Cup, 1m),
        new(Oat, Milk, 50m)
    ];

    [Fact]
    public void Requirements_SingleLine_IsQuantityPerSaleTimesQuantity()
    {
        var line = new StockLine(Guid.NewGuid(), null, Latte, 3);

        var required = StockRules.Requirements([line], Links);

        required.Single(r => r.ItemId == Milk).Quantity.ShouldBe(600m);
        required.Single(r => r.ItemId == Milk).OrderLineId.ShouldBe(line.LineId);
        required.Single(r => r.ItemId == Cup).Quantity.ShouldBe(3m);
    }

    [Fact]
    public void Requirements_AddOnQuantityIsPerUnitOfTheParent()
    {
        var parent = new StockLine(Guid.NewGuid(), null, Latte, 3);
        var addOn = new StockLine(Guid.NewGuid(), parent.LineId, Oat, 2);

        var required = StockRules.Requirements([parent, addOn], Links);

        // 3 lattes x 200 ml, plus 3 x 2 oat shots x 50 ml, from the same item but a different product.
        required.Where(r => r.ItemId == Milk).Sum(r => r.Quantity).ShouldBe(900m);
        required.Single(r => r.ProductId == Oat).Quantity.ShouldBe(300m);
    }

    [Fact]
    public void Requirements_SeveralLinesOfOneProduct_AreSummedWithoutALineId()
    {
        var lines = new[]
        {
            new StockLine(Guid.NewGuid(), null, Latte, 1),
            new StockLine(Guid.NewGuid(), null, Latte, 2)
        };

        var required = StockRules.Requirements(lines, Links);

        required.Single(r => r.ItemId == Milk).Quantity.ShouldBe(600m);
        required.Single(r => r.ItemId == Milk).OrderLineId.ShouldBeNull();
    }

    [Fact]
    public void Requirements_ProductsSharingAnItem_StayApartPerProduct()
    {
        var lines = new[]
        {
            new StockLine(Guid.NewGuid(), null, Latte, 1),
            new StockLine(Guid.NewGuid(), null, Mocha, 1)
        };

        var required = StockRules.Requirements(lines, Links).Where(r => r.ItemId == Cup).ToList();

        required.Count.ShouldBe(2);
        required.Sum(r => r.Quantity).ShouldBe(2m);
    }

    [Fact]
    public void Requirements_UnlinkedProduct_NeedsNothing() =>
        StockRules.Requirements([new StockLine(Guid.NewGuid(), null, Guid.NewGuid(), 5)], Links).ShouldBeEmpty();

    [Fact]
    public void Reconcile_NothingTakenYet_TakesEverything()
    {
        var required = new[] { new StockRequirement(Milk, Latte, 600m, null) };

        var changes = StockRules.Reconcile(required, []);

        changes.Single().Quantity.ShouldBe(-600m);
    }

    [Fact]
    public void Reconcile_AlreadyTakenTheSame_ChangesNothing()
    {
        var required = new[] { new StockRequirement(Milk, Latte, 600m, null) };

        StockRules.Reconcile(required, [new StockChange(Milk, Latte, 600m, null)]).ShouldBeEmpty();
    }

    [Fact]
    public void Reconcile_NeedsMore_TakesOnlyTheDifference()
    {
        var required = new[] { new StockRequirement(Milk, Latte, 800m, null) };

        StockRules.Reconcile(required, [new StockChange(Milk, Latte, 600m, null)]).Single().Quantity.ShouldBe(-200m);
    }

    [Fact]
    public void Reconcile_NeedsLess_GivesTheDifferenceBack()
    {
        var required = new[] { new StockRequirement(Milk, Latte, 200m, null) };

        StockRules.Reconcile(required, [new StockChange(Milk, Latte, 600m, null)]).Single().Quantity.ShouldBe(400m);
    }

    [Fact]
    public void Reconcile_LineRemoved_GivesItAllBack()
    {
        StockRules.Reconcile([], [new StockChange(Milk, Latte, 600m, null)]).Single().Quantity.ShouldBe(600m);
    }

    [Theory]
    [InlineData(100, 600, 500)]
    [InlineData(600, 600, 0)]
    [InlineData(-50, 600, 600)]
    [InlineData(1000, 600, 0)]
    public void Shortfall_IsWhatTheBalanceCannotCover(int balance, int needed, int expected) =>
        StockRules.Shortfall(balance, needed).ShouldBe(expected);

    [Theory]
    [InlineData(600, 2, 3, 400)]
    [InlineData(600, 0, 3, 0)]
    [InlineData(600, 3, 3, 600)]
    [InlineData(600, 1, 0, 0)]
    public void ReturnedShare_FollowsTheUnitsOnReturnedLines(int quantity, int returned, int total, int expected) =>
        StockRules.ReturnedShare(quantity, returned, total).ShouldBe(expected);

    [Theory]
    [InlineData(10, 7, -3)]
    [InlineData(10, 10, 0)]
    [InlineData(-4, 0, 4)]
    public void AdjustmentDelta_IsCountedMinusExpected(int expected, int counted, int delta) =>
        StockRules.AdjustmentDelta(expected, counted).ShouldBe(delta);
}
