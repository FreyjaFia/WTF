using WTF.Calculations.Orders;

namespace WTF.Tests.Calculations;

public class AddOnSelectionRulesTests
{
    private static readonly AddOnTypeRule Temperature = new(7, "Temperature", true, 1, 1);
    private static readonly AddOnTypeRule Topping = new(3, "Topping", false, 0, 0);
    private static readonly AddOnTypeRule TwoToppings = new(8, "Crunch", false, 1, 2);

    [Fact]
    public void RequiredPickOne_NeedsExactlyOne()
    {
        AddOnSelectionRules.Check(Temperature, 1).ShouldBeNull();
        AddOnSelectionRules.Check(Temperature, 0).ShouldBe("A temperature selection is required and must be exactly one.");
        AddOnSelectionRules.Check(Temperature, 2).ShouldBe("A temperature selection is required and must be exactly one.");
    }

    [Fact]
    public void RequiredWithoutMinimum_MeansAtLeastOne()
    {
        var rule = new AddOnTypeRule(9, "Milk", true, 0, 0);

        rule.Minimum.ShouldBe(1);
        AddOnSelectionRules.Check(rule, 0).ShouldNotBeNull();
        AddOnSelectionRules.Check(rule, 5).ShouldBeNull();
    }

    [Fact]
    public void OptionalUnlimited_AcceptsAnyCount()
    {
        AddOnSelectionRules.Check(Topping, 0).ShouldBeNull();
        AddOnSelectionRules.Check(Topping, 12).ShouldBeNull();
        Topping.PickOne.ShouldBeFalse();
    }

    [Fact]
    public void Range_ChecksBothEnds()
    {
        AddOnSelectionRules.Check(TwoToppings, 0).ShouldBe("A crunch selection is required: choose at least 1.");
        AddOnSelectionRules.Check(TwoToppings, 2).ShouldBeNull();
        AddOnSelectionRules.Check(TwoToppings, 3).ShouldBe("A crunch selection must be at most 2.");
    }

    [Fact]
    public void OptionalPickOne_AllowsNoneOrOne()
    {
        var sauce = new AddOnTypeRule(5, "Sauce", false, 0, 1);

        AddOnSelectionRules.Check(sauce, 0).ShouldBeNull();
        AddOnSelectionRules.Check(sauce, 1).ShouldBeNull();
        AddOnSelectionRules.Check(sauce, 2).ShouldBe("A sauce selection must be at most one.");
        sauce.PickOne.ShouldBeTrue();
    }
}
