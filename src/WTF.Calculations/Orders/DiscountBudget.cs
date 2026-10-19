namespace WTF.Calculations.Orders;

// How many items each limited promotion can still discount for ONE order: the uses nobody holds yet (the pool, shared by
// every order) and the most one order may take (the per-order limit). An order gets the smaller of the two.
public sealed class DiscountBudget(
    IReadOnlyDictionary<Guid, int> poolRemaining,
    IReadOnlyDictionary<Guid, int>? perOrderRemaining = null)
{
    private readonly Dictionary<Guid, int> _pool = new(poolRemaining);
    private readonly Dictionary<Guid, int> _perOrder = new(perOrderRemaining ?? new Dictionary<Guid, int>());

    // Gives uses back, for an order that already holds them (its own reservation is not a use that is gone for it).
    // Only the pool gets them back: the per-order limit counts what this order takes while it is being priced.
    public void Return(Guid? promotionId, int quantity)
    {
        if (promotionId is { } id && _pool.TryGetValue(id, out var left))
        {
            _pool[id] = left + quantity;
        }
    }

    // Uses left in the pool, or null when the promotion has no usage limit.
    public int? Remaining(Guid? promotionId)
    {
        return promotionId is { } id && _pool.TryGetValue(id, out var left) ? Math.Max(0, left) : null;
    }

    // How many more items this order can discount at the promotion, or null when nothing limits it.
    public int? Available(Guid? promotionId)
    {
        if (promotionId is not { } id)
        {
            return null;
        }

        int? available = null;
        if (_pool.TryGetValue(id, out var pool))
        {
            available = Math.Max(0, pool);
        }

        if (_perOrder.TryGetValue(id, out var perOrder))
        {
            available = available is null ? Math.Max(0, perOrder) : Math.Min(available.Value, Math.Max(0, perOrder));
        }

        return available;
    }

    public DiscountBudget Clone() => new(_pool, _perOrder);

    public bool CanUse(Guid? promotionId, int quantity)
    {
        return Available(promotionId) is not { } available || available >= quantity;
    }

    public void Use(Guid? promotionId, int quantity)
    {
        if (promotionId is not { } id)
        {
            return;
        }

        if (_pool.TryGetValue(id, out var pool))
        {
            _pool[id] = pool - quantity;
        }

        if (_perOrder.TryGetValue(id, out var perOrder))
        {
            _perOrder[id] = perOrder - quantity;
        }
    }
}
