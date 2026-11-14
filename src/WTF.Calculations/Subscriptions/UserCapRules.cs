namespace WTF.Calculations.Subscriptions;

public static class UserCapRules
{
    // A null cap means the plan has no limit.
    public static bool CanAddUser(int activeUsers, int? maxUsers) => maxUsers is not { } cap || activeUsers < cap;

    // After a downgrade a shop can hold more active users than the new plan allows. They keep working; only new and
    // re-activated seats are refused until the count is back under the cap.
    public static int UsersOverCap(int activeUsers, int? maxUsers) => maxUsers is { } cap ? Math.Max(0, activeUsers - cap) : 0;
}
