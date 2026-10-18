namespace WTF.Calculations.Orders;

public sealed class DiscountBudget(IReadOnlyDictionary<Guid, int> remainingByPromotionId)
{
    private readonly Dictionary<Guid, int> _remaining = new(remainingByPromotionId);

    public DiscountBudget Clone() => new(_remaining);

    public bool CanUse(Guid? promotionId, int quantity)
    {
        return promotionId is null
            || !_remaining.TryGetValue(promotionId.Value, out var left)
            || left >= quantity;
    }

    public void Use(Guid? promotionId, int quantity)
    {
        if (promotionId is { } id && _remaining.TryGetValue(id, out var left))
        {
            _remaining[id] = left - quantity;
        }
    }
}
