using WTF.Calculations.Sales;
using WTF.Calculations.Time;

namespace WTF.Calculations.Kitchen;

public sealed record KitchenLine(string Key, string Label, int Quantity);

public sealed record KitchenLineDiff(bool HasAdded, bool HasRemoved, string Note);

public sealed record KitchenEditOutcome(KitchenState? NewState, KitchenChangeKind Kind, string? Note);

// What the kitchen board shows and which taps are allowed. The board needs the network, so the POS only displays what the
// API returns and keeps no copy of these rules (apart from the amber / red age colours, which are display only).
public static class KitchenBoardRules
{
    public const int NoteMaxLength = 300;

    public static bool IsOnBoard(int orderStatusId, byte? kitchenStatus) =>
        orderStatusId is OrderStatuses.Pending or OrderStatuses.Completed
        && kitchenStatus is >= (byte)KitchenState.New and <= (byte)KitchenState.Ready;

    // A cancelled or refunded order the kitchen had already started shows as a red "stop making" card until dismissed.
    public static bool IsStopMakingCard(int orderStatusId, byte? kitchenStatus, bool dismissed) =>
        !dismissed
        && orderStatusId is OrderStatuses.Cancelled or OrderStatuses.Refunded
        && kitchenStatus is (byte)KitchenState.Preparing or (byte)KitchenState.Ready;

    public static bool IsStale(DateTime createdAtUtc, DateTime nowUtc, TimeZoneInfo timeZone) =>
        ReportPeriods.LocalDate(createdAtUtc, timeZone) < ReportPeriods.LocalDate(nowUtc, timeZone);

    // Forward taps may skip steps and are harmless when repeated. Back is one step at a time; Served goes back to Ready only
    // from the Served view ("Bring back").
    public static KitchenMove Decide(KitchenState from, KitchenState to, bool bringBack = false)
    {
        if (from == to)
        {
            return KitchenMove.AlreadyThere;
        }

        if (to > from)
        {
            return KitchenMove.Moved;
        }

        if (from == KitchenState.Served)
        {
            return to == KitchenState.Ready && bringBack ? KitchenMove.Moved : KitchenMove.Refused;
        }

        return (int)from - (int)to == 1 ? KitchenMove.Moved : KitchenMove.Refused;
    }

    // A forward tap that finds the order further along already is not an error (two tablets tapping at once).
    public static KitchenMove DecideForward(KitchenState current, KitchenState wanted) =>
        current >= wanted ? KitchenMove.AlreadyThere : KitchenMove.Moved;

    // Compares what the kitchen had with what the order now holds. Lines are matched by key (product, size, add-ons including
    // temperature, notes) and quantities of equal keys are summed, so a discount that splits one line in two, or a different
    // line order, never counts as a change.
    public static KitchenLineDiff Diff(IEnumerable<KitchenLine> before, IEnumerable<KitchenLine> after)
    {
        var old = Totals(before);
        var current = Totals(after);
        var parts = new List<string>();
        var added = false;
        var removed = false;

        foreach (var (key, now) in current.OrderBy(x => x.Key, StringComparer.Ordinal))
        {
            old.TryGetValue(key, out var was);
            if (now.Quantity > (was?.Quantity ?? 0))
            {
                added = true;
                parts.Add($"+{now.Quantity - (was?.Quantity ?? 0)} {now.Label}");
            }
        }

        foreach (var (key, was) in old.OrderBy(x => x.Key, StringComparer.Ordinal))
        {
            current.TryGetValue(key, out var now);
            if (was.Quantity > (now?.Quantity ?? 0))
            {
                removed = true;
                parts.Add($"-{was.Quantity - (now?.Quantity ?? 0)} {was.Label}");
            }
        }

        var note = string.Join(", ", parts);
        if (note.Length > NoteMaxLength)
        {
            note = note[..(NoteMaxLength - 1)] + "…";
        }

        return new KitchenLineDiff(added, removed, note);
    }

    // What an edit does to the kitchen state and the tag on the card. Null NewState means the state stays as it is.
    public static KitchenEditOutcome AfterEdit(KitchenState state, KitchenLineDiff diff)
    {
        if (!diff.HasAdded && !diff.HasRemoved)
        {
            return new KitchenEditOutcome(null, KitchenChangeKind.None, null);
        }

        if (diff.HasAdded && state >= KitchenState.Ready)
        {
            return new KitchenEditOutcome(
                KitchenState.New, diff.HasRemoved ? KitchenChangeKind.Changed : KitchenChangeKind.Added, diff.Note);
        }

        if (state == KitchenState.Served)
        {
            return new KitchenEditOutcome(null, KitchenChangeKind.None, null);
        }

        var kind = diff.HasRemoved ? KitchenChangeKind.Changed : KitchenChangeKind.Added;
        return new KitchenEditOutcome(state == KitchenState.Ready ? KitchenState.Preparing : null, kind, diff.Note);
    }

    private static Dictionary<string, KitchenLine> Totals(IEnumerable<KitchenLine> lines)
    {
        var totals = new Dictionary<string, KitchenLine>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            totals[line.Key] = totals.TryGetValue(line.Key, out var existing)
                ? existing with { Quantity = existing.Quantity + line.Quantity }
                : line;
        }

        return totals;
    }
}
