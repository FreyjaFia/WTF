namespace WTF.Calculations.Orders;

public static class PromotionSchedule
{
    public const byte EveryDay = 127;

    // The weekday bit is 1 << DayOfWeek, so Sunday is 1, Monday 2 ... Saturday 64. The weekday is the one the moment
    // falls on: the part of a window past midnight belongs to the next day.
    public static bool IsOpen(byte? daysOfWeek, TimeOnly? start, TimeOnly? end, DateTime localNow)
    {
        if (daysOfWeek.HasValue && (daysOfWeek.Value & (1 << (int)localNow.DayOfWeek)) == 0)
        {
            return false;
        }

        if (!start.HasValue || !end.HasValue)
        {
            return true;
        }

        var time = TimeOnly.FromDateTime(localNow);

        // The end itself is not included. A window that ends before it starts runs past midnight.
        return start.Value <= end.Value
            ? time >= start.Value && time < end.Value
            : time >= start.Value || time < end.Value;
    }
}
