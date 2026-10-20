namespace WTF.Calculations.Inventory;

public record AlertDecision(bool Notify, StockStatus Remember);

public static class StockAlertRules
{
    // An item is alerted when it gets worse than the level the last alert was sent for (warning, then critical, then out
    // of stock, each once). Back to ok forgets the last alert, so a later fall alerts again. A partial recovery (critical
    // back to warning) is remembered without an alert, so falling to critical again alerts again.
    public static AlertDecision Decide(StockStatus lastAlerted, StockStatus current)
    {
        if (current == StockStatus.Ok)
        {
            return new AlertDecision(false, StockStatus.Ok);
        }

        return current > lastAlerted
            ? new AlertDecision(true, current)
            : new AlertDecision(false, current);
    }
}
