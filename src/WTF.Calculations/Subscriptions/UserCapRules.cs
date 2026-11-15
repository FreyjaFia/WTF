namespace WTF.Calculations.Subscriptions;

public static class UserCapRules
{
    // A null cap means the plan has no limit.
    public static bool CanAddUser(int activeUsers, int? maxUsers) => maxUsers is not { } cap || activeUsers < cap;

    // After a downgrade a shop can hold more active users than the new plan allows. The newest ones past the cap are blocked
    // (BlockedUserIds); new and re-activated seats are refused until the count is back under the cap.
    public static int UsersOverCap(int activeUsers, int? maxUsers) => maxUsers is { } cap ? Math.Max(0, activeUsers - cap) : 0;

    public static IReadOnlySet<Guid> BlockedUserIds(IEnumerable<SeatCandidate> activeUsers, int? maxUsers)
    {
        if (maxUsers is not { } cap)
        {
            return new HashSet<Guid>();
        }

        // Owners keep their seat even when the plan is smaller than the number of owners; the oldest other users fill the rest.
        var ordered = activeUsers.OrderByDescending(u => u.IsOwner).ThenBy(u => u.CreatedAt).ThenBy(u => u.Id).ToList();
        var kept = Math.Max(cap, ordered.Count(u => u.IsOwner));
        return ordered.Skip(kept).Select(u => u.Id).ToHashSet();
    }
}

public sealed record SeatCandidate(Guid Id, bool IsOwner, DateTime CreatedAt);
