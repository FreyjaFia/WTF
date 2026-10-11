using WTF.Domain.Entities;
using static WTF.Tests.Features.Pricing.PricingCopies;

namespace WTF.Tests.Features.Pricing;

public class PromotionActiveDateTests
{
    private static readonly TimeZoneInfo Utc = TimeZoneInfo.Utc;
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila"); // UTC+8, no DST

    public static IEnumerable<object[]> Copies() => new[] { "Create", "Update" }.Select(c => new object[] { c });

    private static DateTime U(int y, int m, int d, int h = 0, int min = 0, int s = 0) =>
        new(y, m, d, h, min, s, DateTimeKind.Utc);

    private static Promotion Promo(DateTime? start, DateTime? end, bool active = true) =>
        new() { Id = Guid.NewGuid(), Name = "P", IsActive = active, StartDate = start, EndDate = end };

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_InactivePromotion_IsAlwaysFalse(string copy)
    {
        IsActive(copy, Promo(null, null, active: false), U(2026, 1, 1), Utc).ShouldBeFalse();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_NoDates_IsTrue(string copy)
    {
        IsActive(copy, Promo(null, null), U(2026, 1, 1), Utc).ShouldBeTrue();
        IsActive(copy, Promo(null, null), U(2026, 1, 1), Manila).ShouldBeTrue();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_OnlyStartDate_OpenEnded(string copy)
    {
        var p = Promo(U(2026, 3, 10), null);
        IsActive(copy, p, U(2026, 3, 9, 23, 59, 59), Utc).ShouldBeFalse();
        IsActive(copy, p, U(2026, 3, 10), Utc).ShouldBeTrue();
        IsActive(copy, p, U(2030, 1, 1), Utc).ShouldBeTrue();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_OnlyEndDate_OpenStart(string copy)
    {
        var p = Promo(null, U(2026, 3, 10));
        IsActive(copy, p, U(2020, 1, 1), Utc).ShouldBeTrue();
        IsActive(copy, p, U(2026, 3, 10, 23, 59, 59), Utc).ShouldBeTrue();
        IsActive(copy, p, U(2026, 3, 11), Utc).ShouldBeFalse();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_StartAndEndAreInclusiveByLocalDate_InUtc(string copy)
    {
        var p = Promo(U(2026, 3, 10, 15), U(2026, 3, 12, 9)); // times of day are ignored, only the date matters
        IsActive(copy, p, U(2026, 3, 9, 23, 59, 59), Utc).ShouldBeFalse();
        IsActive(copy, p, U(2026, 3, 10, 0), Utc).ShouldBeTrue();   // before the start time but on the start date
        IsActive(copy, p, U(2026, 3, 11), Utc).ShouldBeTrue();
        IsActive(copy, p, U(2026, 3, 12, 23, 59, 59), Utc).ShouldBeTrue(); // after the end time but on the end date
        IsActive(copy, p, U(2026, 3, 13, 0), Utc).ShouldBeFalse();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_SingleDayPromotion_ActiveOnlyThatDay(string copy)
    {
        var p = Promo(U(2026, 5, 5), U(2026, 5, 5));
        IsActive(copy, p, U(2026, 5, 4, 23, 59, 59), Utc).ShouldBeFalse();
        IsActive(copy, p, U(2026, 5, 5, 12), Utc).ShouldBeTrue();
        IsActive(copy, p, U(2026, 5, 6), Utc).ShouldBeFalse();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_ManilaStartsAtLocalMidnight(string copy)
    {
        // Start = 2026-03-11 00:00 Manila = 2026-03-10 16:00 UTC.
        var p = Promo(U(2026, 3, 10, 16), null);
        IsActive(copy, p, U(2026, 3, 10, 15, 59, 59), Manila).ShouldBeFalse(); // 23:59:59 local on the 10th
        IsActive(copy, p, U(2026, 3, 10, 16, 0, 0), Manila).ShouldBeTrue();    // 00:00:00 local on the 11th
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_ManilaEndsAtEndOfLocalDay(string copy)
    {
        // End = 2026-03-11 00:00 Manila (= 2026-03-10 16:00 UTC); the whole local 11th is still active.
        var p = Promo(null, U(2026, 3, 10, 16));
        IsActive(copy, p, U(2026, 3, 11, 15, 59, 59), Manila).ShouldBeTrue();  // 23:59:59 local on the 11th
        IsActive(copy, p, U(2026, 3, 11, 16, 0, 0), Manila).ShouldBeFalse();   // 00:00:00 local on the 12th
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_SameInstantDiffersBetweenUtcAndManila(string copy)
    {
        var p = Promo(U(2026, 3, 11), U(2026, 3, 11)); // start/end in Manila = 08:00 on the 11th
        var instant = U(2026, 3, 10, 17); // UTC 10th 17:00 = Manila 11th 01:00

        IsActive(copy, p, instant, Utc).ShouldBeFalse();
        IsActive(copy, p, instant, Manila).ShouldBeTrue();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_NonUtcKindReference_IsTreatedAsUtc(string copy)
    {
        var p = Promo(U(2026, 3, 11), null);
        var unspecified = new DateTime(2026, 3, 10, 17, 0, 0, DateTimeKind.Unspecified);
        var local = new DateTime(2026, 3, 10, 17, 0, 0, DateTimeKind.Local);

        IsActive(copy, p, unspecified, Manila).ShouldBeTrue();
        // SpecifyKind forces UTC regardless of the original kind, so Local behaves the same.
        IsActive(copy, p, local, Manila).ShouldBeTrue();
    }

    [Theory, MemberData(nameof(Copies))]
    public void IsActive_UnspecifiedKindPromotionDates_AreTreatedAsUtc(string copy)
    {
        var p = Promo(new DateTime(2026, 3, 10, 16, 0, 0, DateTimeKind.Unspecified), null);
        IsActive(copy, p, U(2026, 3, 10, 15, 59, 59), Manila).ShouldBeFalse();
        IsActive(copy, p, U(2026, 3, 10, 16, 0, 0), Manila).ShouldBeTrue();
    }

    [Fact]
    public void IsActive_CreateAndUpdate_AgreeOnEveryScenario()
    {
        DateTime?[] starts = [null, U(2026, 3, 10), U(2026, 3, 10, 16)];
        DateTime?[] ends = [null, U(2026, 3, 12), U(2026, 3, 12, 16)];
        var refs = Enumerable.Range(0, 24 * 6).Select(i => U(2026, 3, 8).AddHours(i)).ToList();

        foreach (var tz in new[] { Utc, Manila })
        foreach (var active in new[] { true, false })
        foreach (var s in starts)
        foreach (var e in ends)
        foreach (var r in refs)
        {
            var p = Promo(s, e, active);
            IsActive("Update", p, r, tz).ShouldBe(IsActive("Create", p, r, tz));
        }
    }
}
