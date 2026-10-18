using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

public class PromotionScheduleRulesTests
{
    // 10 Jun 2026 is a Wednesday.
    private static DateTime At(int hour, int minute = 0, int day = 10) => new(2026, 6, day, hour, minute, 0);

    [Fact]
    public void IsOpen_NoScheduleAtAll_IsAlwaysOpen()
    {
        PromotionSchedule.IsOpen(null, null, null, At(3)).ShouldBeTrue();
        PromotionSchedule.IsOpen(null, null, null, At(23, 59, 14)).ShouldBeTrue();
    }

    // June 2026: the 8th is a Monday, the 9th a Tuesday, the 10th a Wednesday, the 13th a Saturday, the 14th a Sunday.
    [Theory]
    [InlineData(8, 2, true)]
    [InlineData(9, 4, true)]
    [InlineData(10, 8, true)]
    [InlineData(10, 2, false)]
    [InlineData(9, 8, false)]
    [InlineData(10, 2 | 4 | 8, true)]
    [InlineData(11, 2 | 4 | 8, false)]
    public void IsOpen_ByWeekday_UsesTheBitOfThatDay(int dayOfMonth, int mask, bool expected)
    {
        PromotionSchedule.IsOpen((byte)mask, null, null, At(12, 0, dayOfMonth)).ShouldBe(expected);
    }

    [Fact]
    public void IsOpen_SundayIsBitOneAndSaturdayBitSixtyFour()
    {
        PromotionSchedule.IsOpen(1, null, null, At(12, 0, 14)).ShouldBeTrue();
        PromotionSchedule.IsOpen(64, null, null, At(12, 0, 13)).ShouldBeTrue();
        PromotionSchedule.IsOpen(1, null, null, At(12, 0, 13)).ShouldBeFalse();
    }

    [Fact]
    public void IsOpen_EveryDayMask_IsOpenOnAllDays()
    {
        for (var day = 8; day <= 14; day++)
        {
            PromotionSchedule.IsOpen(PromotionSchedule.EveryDay, null, null, At(12, 0, day)).ShouldBeTrue();
        }
    }

    [Theory]
    [InlineData(13, 59, false)]
    [InlineData(14, 0, true)]
    [InlineData(16, 59, true)]
    [InlineData(17, 0, false)]
    [InlineData(23, 0, false)]
    public void IsOpen_DailyWindow_IncludesTheStartAndExcludesTheEnd(int hour, int minute, bool expected)
    {
        PromotionSchedule.IsOpen(null, new TimeOnly(14, 0), new TimeOnly(17, 0), At(hour, minute)).ShouldBe(expected);
    }

    [Theory]
    [InlineData(21, 59, false)]
    [InlineData(22, 0, true)]
    [InlineData(23, 30, true)]
    [InlineData(0, 0, true)]
    [InlineData(1, 59, true)]
    [InlineData(2, 0, false)]
    [InlineData(12, 0, false)]
    public void IsOpen_WindowPastMidnight_CoversBothSides(int hour, int minute, bool expected)
    {
        PromotionSchedule.IsOpen(null, new TimeOnly(22, 0), new TimeOnly(2, 0), At(hour, minute)).ShouldBe(expected);
    }

    [Fact]
    public void IsOpen_NeedsTheDayAndTheWindow()
    {
        var wednesday = (byte)8;
        PromotionSchedule.IsOpen(wednesday, new TimeOnly(14, 0), new TimeOnly(17, 0), At(15)).ShouldBeTrue();
        PromotionSchedule.IsOpen(wednesday, new TimeOnly(14, 0), new TimeOnly(17, 0), At(18)).ShouldBeFalse();
        PromotionSchedule.IsOpen(wednesday, new TimeOnly(14, 0), new TimeOnly(17, 0), At(15, 0, 11)).ShouldBeFalse();
    }

    [Fact]
    public void IsPromotionActive_UsesTheShopsLocalTimeForTheSchedule()
    {
        var promotion = new Promotion { IsActive = true, StartTime = new TimeOnly(14, 0), EndTime = new TimeOnly(17, 0) };
        var manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

        // 07:00 UTC is 15:00 in Manila (open); 12:00 UTC is 20:00 there (closed), though it is also inside 14-17 in UTC terms
        // for a shop on UTC.
        PromotionPricing.IsPromotionActiveOnLocalDate(promotion, new DateTime(2026, 6, 10, 7, 0, 0, DateTimeKind.Utc), manila).ShouldBeTrue();
        PromotionPricing.IsPromotionActiveOnLocalDate(promotion, new DateTime(2026, 6, 10, 12, 0, 0, DateTimeKind.Utc), manila).ShouldBeFalse();
        PromotionPricing.IsPromotionActiveOnLocalDate(promotion, new DateTime(2026, 6, 10, 15, 0, 0, DateTimeKind.Utc), TimeZoneInfo.Utc).ShouldBeTrue();
    }

    [Fact]
    public void IsPromotionActive_AnInactivePromotionIsNeverOpen()
    {
        var promotion = new Promotion { IsActive = false };

        PromotionPricing.IsPromotionActiveOnLocalDate(promotion, DateTime.UtcNow, TimeZoneInfo.Utc).ShouldBeFalse();
    }

    [Fact]
    public void DiscountBudget_ExhaustedPromotionsCannotBeUsed_AndUnlimitedOnesAlwaysCan()
    {
        var limited = Guid.NewGuid();
        var budget = new DiscountBudget(new Dictionary<Guid, int> { [limited] = 3 });

        budget.CanUse(limited, 3).ShouldBeTrue();
        budget.CanUse(limited, 4).ShouldBeFalse();
        budget.Use(limited, 2);
        budget.CanUse(limited, 1).ShouldBeTrue();
        budget.CanUse(limited, 2).ShouldBeFalse();
        budget.CanUse(Guid.NewGuid(), 99).ShouldBeTrue();
        budget.CanUse(null, 99).ShouldBeTrue();
        budget.Use(null, 5);
    }
}
