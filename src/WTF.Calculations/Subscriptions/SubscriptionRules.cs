namespace WTF.Calculations.Subscriptions;

public enum SubscriptionWarning
{
    None = 0,
    Soon = 1,
    LastDays = 2,
    Grace = 3,
    Locked = 4
}

// Dates are UTC. A shop is paid up to the period end, keeps working through the grace days (with warnings) and is locked from
// the end of the grace. The app on a device runs the same rules from the lease it last received (shared cases in calculation-cases.json).
public static class SubscriptionRules
{
    public const int SoonDays = 7;

    public const int LastDaysCount = 3;

    public const int MonthsPerYear = 12;

    public const int MonthsPaidPerYear = 10;

    public static DateTime AccessUntil(DateTime periodEnd, int graceDays) => periodEnd.AddDays(Math.Max(0, graceDays));

    public static int DaysLeft(DateTime periodEnd, DateTime now)
    {
        var remaining = periodEnd - now;
        return remaining <= TimeSpan.Zero ? 0 : (int)Math.Ceiling(remaining.TotalDays);
    }

    public static SubscriptionWarning WarningLevel(DateTime periodEnd, int graceDays, DateTime now)
    {
        if (now >= AccessUntil(periodEnd, graceDays))
        {
            return SubscriptionWarning.Locked;
        }

        if (now >= periodEnd)
        {
            return SubscriptionWarning.Grace;
        }

        var daysLeft = DaysLeft(periodEnd, now);
        if (daysLeft <= LastDaysCount)
        {
            return SubscriptionWarning.LastDays;
        }

        return daysLeft <= SoonDays ? SubscriptionWarning.Soon : SubscriptionWarning.None;
    }

    public static bool AllowsAccess(DateTime periodEnd, int graceDays, DateTime now) =>
        WarningLevel(periodEnd, graceDays, now) != SubscriptionWarning.Locked;

    // The device clock can be set back; the latest time ever seen (from the server or the device) is never undone.
    public static DateTime EffectiveNow(DateTime deviceNow, DateTime? latestSeen) =>
        latestSeen is { } seen && seen > deviceNow ? seen : deviceNow;

    public static bool LeaseTooOld(DateTime issuedAt, DateTime now, int maxAgeDays) =>
        now - issuedAt > TimeSpan.FromDays(Math.Max(0, maxAgeDays));

    // A payment extends from the end of the current period when it is still ahead, or from today when the shop had lapsed.
    public static (DateTime Start, DateTime End) NextPeriod(DateTime? currentEnd, DateTime now, int months)
    {
        var start = currentEnd is { } end && end > now ? end : now;
        return (start, start.AddMonths(Math.Max(1, months)));
    }

    // A full year costs ten months; the rest is charged monthly. A discount (the pilot shop) is a percentage off.
    public static decimal InvoiceAmount(decimal monthlyPrice, int months, decimal discountPercent = 0)
    {
        var safeMonths = Math.Max(1, months);
        var paidMonths = (safeMonths / MonthsPerYear * MonthsPaidPerYear) + (safeMonths % MonthsPerYear);
        var gross = monthlyPrice * paidMonths;
        var percent = Math.Clamp(discountPercent, 0m, 100m);
        return Math.Round(gross * (100m - percent) / 100m, 2, MidpointRounding.AwayFromZero);
    }
}
