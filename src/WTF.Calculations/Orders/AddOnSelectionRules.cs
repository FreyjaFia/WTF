namespace WTF.Calculations.Orders;

public record AddOnTypeRule(int Id, string Name, bool IsRequired, int MinSelect, int MaxSelect)
{
    public int Minimum => IsRequired ? Math.Max(MinSelect, 1) : Math.Max(MinSelect, 0);

    public int Maximum => MaxSelect > 0 ? MaxSelect : int.MaxValue;

    public bool PickOne => MaxSelect == 1;
}

public static class AddOnSelectionRules
{
    public static string? Check(AddOnTypeRule rule, int selected)
    {
        var name = rule.Name.Trim().ToLowerInvariant();

        if (rule.Minimum == 1 && rule.MaxSelect == 1 && selected != 1)
        {
            return $"A {name} selection is required and must be exactly one.";
        }

        if (selected < rule.Minimum)
        {
            return $"A {name} selection is required: choose at least {rule.Minimum}.";
        }

        if (selected > rule.Maximum)
        {
            return rule.Maximum == 1
                ? $"A {name} selection must be at most one."
                : $"A {name} selection must be at most {rule.Maximum}.";
        }

        return null;
    }
}
