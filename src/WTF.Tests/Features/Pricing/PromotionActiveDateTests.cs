using WTF.Domain.Entities;
using static WTF.Tests.Features.Pricing.PricingTestHelpers;

namespace WTF.Tests.Features.Pricing;

public class PromotionActiveDateTests
{
    private static readonly TimeZoneInfo Utc = TimeZoneInfo.Utc;
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila"); // UTC+8, no DST

    private static DateTime U(int y, int m, int d, int h = 0, int min = 0, int s = 0) =>
        new(y, m, d, h, min, s, DateTimeKind.Utc);

    private static Promotion Promo(DateTime? start, DateTime? end, bool active = true) =>
        new() { Id = Guid.NewGuid(), Name = "P", IsActive = active, StartDate = start, EndDate = end };

    [Fact]
    public void IsActive_InactivePromotion_IsAlwaysFalse()
    {
        IsActive(Promo(null, null, active: false), U(2026, 1, 1), Utc).ShouldBeFalse();
    }

    [Fact]
    public void IsActive_NoDates_IsTrue()
    {
        IsActive(Promo(null, null), U(2026, 1, 1), Utc).ShouldBeTrue();
        IsActive(Promo(null, null), U(2026, 1, 1), Manila).ShouldBeTrue();
    }

    [Fact]
    public void IsActive_OnlyStartDate_OpenEnded()
    {
        var p = Promo(U(2026, 3, 10), null);
        IsActive(p, U(2026, 3, 9, 23, 59, 59), Utc).ShouldBeFalse();
        IsActive(p, U(2026, 3, 10), Utc).ShouldBeTrue();
        IsActive(p, U(2030, 1, 1), Utc).ShouldBeTrue();
    }

    [Fact]
    public void IsActive_OnlyEndDate_OpenStart()
    {
        var p = Promo(null, U(2026, 3, 10));
        IsActive(p, U(2020, 1, 1), Utc).ShouldBeTrue();
        IsActive(p, U(2026, 3, 10, 23, 59, 59), Utc).ShouldBeTrue();
        IsActive(p, U(2026, 3, 11), Utc).ShouldBeFalse();
    }

    [Fact]
    public void IsActive_StartAndEndAreInclusiveByLocalDate_InUtc()
    {
        var p = Promo(U(2026, 3, 10, 15), U(2026, 3, 12, 9)); // times of day are ignored, only the date matters
        IsActive(p, U(2026, 3, 9, 23, 59, 59), Utc).ShouldBeFalse();
        IsActive(p, U(2026, 3, 10, 0), Utc).ShouldBeTrue();   // before the start time but on the start date
        IsActive(p, U(2026, 3, 11), Utc).ShouldBeTrue();
        IsActive(p, U(2026, 3, 12, 23, 59, 59), Utc).ShouldBeTrue(); // after the end time but on the end date
        IsActive(p, U(2026, 3, 13, 0), Utc).ShouldBeFalse();
    }

    [Fact]
    public void IsActive_SingleDayPromotion_ActiveOnlyThatDay()
    {
        var p = Promo(U(2026, 5, 5), U(2026, 5, 5));
        IsActive(p, U(2026, 5, 4, 23, 59, 59), Utc).ShouldBeFalse();
        IsActive(p, U(2026, 5, 5, 12), Utc).ShouldBeTrue();
        IsActive(p, U(2026, 5, 6), Utc).ShouldBeFalse();
    }

    [Fact]
    public void IsActive_ManilaStartsAtLocalMidnight()
    {
        // Start = 2026-03-11 00:00 Manila = 2026-03-10 16:00 UTC.
        var p = Promo(U(2026, 3, 10, 16), null);
        IsActive(p, U(2026, 3, 10, 15, 59, 59), Manila).ShouldBeFalse(); // 23:59:59 local on the 10th
        IsActive(p, U(2026, 3, 10, 16, 0, 0), Manila).ShouldBeTrue();    // 00:00:00 local on the 11th
    }

    [Fact]
    public void IsActive_ManilaEndsAtEndOfLocalDay()
    {
        // End = 2026-03-11 00:00 Manila (= 2026-03-10 16:00 UTC); the whole local 11th is still active.
        var p = Promo(null, U(2026, 3, 10, 16));
        IsActive(p, U(2026, 3, 11, 15, 59, 59), Manila).ShouldBeTrue();  // 23:59:59 local on the 11th
        IsActive(p, U(2026, 3, 11, 16, 0, 0), Manila).ShouldBeFalse();   // 00:00:00 local on the 12th
    }

    [Fact]
    public void IsActive_SameInstantDiffersBetweenUtcAndManila()
    {
        var p = Promo(U(2026, 3, 11), U(2026, 3, 11)); // start/end in Manila = 08:00 on the 11th
        var instant = U(2026, 3, 10, 17); // UTC 10th 17:00 = Manila 11th 01:00

        IsActive(p, instant, Utc).ShouldBeFalse();
        IsActive(p, instant, Manila).ShouldBeTrue();
    }

    [Fact]
    public void IsActive_NonUtcKindReference_IsTreatedAsUtc()
    {
        var p = Promo(U(2026, 3, 11), null);
        var unspecified = new DateTime(2026, 3, 10, 17, 0, 0, DateTimeKind.Unspecified);
        var local = new DateTime(2026, 3, 10, 17, 0, 0, DateTimeKind.Local);

        IsActive(p, unspecified, Manila).ShouldBeTrue();
        // SpecifyKind forces UTC regardless of the original kind, so Local behaves the same.
        IsActive(p, local, Manila).ShouldBeTrue();
    }

    [Fact]
    public void IsActive_UnspecifiedKindPromotionDates_AreTreatedAsUtc()
    {
        var p = Promo(new DateTime(2026, 3, 10, 16, 0, 0, DateTimeKind.Unspecified), null);
        IsActive(p, U(2026, 3, 10, 15, 59, 59), Manila).ShouldBeFalse();
        IsActive(p, U(2026, 3, 10, 16, 0, 0), Manila).ShouldBeTrue();
    }
}
