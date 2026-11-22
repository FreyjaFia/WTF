using Microsoft.AspNetCore.Http;
using WTF.Api.Common.Tenancy;

namespace WTF.Tests.Tenancy;

public class OfflineSyncWindowTests
{
    private static readonly DateTime Now = new(2026, 11, 8, 12, 0, 0, DateTimeKind.Utc);

    private static DefaultHttpContext Closed(DateTime closedSince, string? lastOnline = null)
    {
        var context = new DefaultHttpContext();
        OfflineSyncWindow.Open(context, closedSince);
        if (lastOnline is not null)
        {
            context.Request.Headers[OfflineSyncWindow.LastOnlineHeader] = lastOnline;
        }

        return context;
    }

    [Fact]
    public void OpenShop_AcceptsAnything() =>
        OfflineSyncWindow.Check(new DefaultHttpContext(), Now.AddDays(-3), Now).ShouldBeNull();

    [Fact]
    public void OrderMadeBeforeTheCutOff_IsAccepted() =>
        OfflineSyncWindow.Check(Closed(Now.AddDays(-1)), Now.AddDays(-2), Now).ShouldBeNull();

    [Fact]
    public void OrderMadeAfterTheCutOff_IsRefused() =>
        OfflineSyncWindow.Check(Closed(Now.AddDays(-2)), Now.AddDays(-1), Now).ShouldNotBeNull();

    [Fact]
    public void OrderWithoutATime_IsRefused() =>
        OfflineSyncWindow.Check(Closed(Now.AddDays(-2)), null, Now).ShouldNotBeNull();

    [Fact]
    public void ClaimedTimeIsCappedAtTheDevicesLastOnline()
    {
        var context = Closed(Now.AddDays(-2), lastOnline: Now.AddDays(-3).ToString("O"));

        OfflineSyncWindow.Check(context, Now.AddDays(-1), Now).ShouldBeNull();
    }

    [Fact]
    public void OrderOlderThanSevenDays_IsRefused() =>
        OfflineSyncWindow.Check(Closed(Now), Now.AddDays(-8), Now).ShouldNotBeNull();

    [Fact]
    public void FutureClaimIsCappedAtNow() =>
        OfflineSyncWindow.Check(Closed(Now.AddHours(-1)), Now.AddDays(5), Now).ShouldNotBeNull();

    [Fact]
    public void OpenShop_StillRefusesAnOrderOlderThanSevenDays() =>
        OfflineSyncWindow.Check(new DefaultHttpContext(), Now.AddDays(-30), Now).ShouldNotBeNull();

    [Fact]
    public void OpenShop_RefusesAnOrderTimedInTheFuture() =>
        OfflineSyncWindow.Check(new DefaultHttpContext(), Now.AddHours(1), Now).ShouldNotBeNull();

    [Fact]
    public void OpenShop_AcceptsAClockThatIsAFewMinutesAhead() =>
        OfflineSyncWindow.Check(new DefaultHttpContext(), Now.AddMinutes(4), Now).ShouldBeNull();

    [Fact]
    public void CatalogTimeAfterTheOrderTime_IsRefused() =>
        OfflineSyncWindow.CheckCatalogTime(Now.AddHours(-1), Now.AddHours(-3), Now).ShouldNotBeNull();

    [Fact]
    public void CatalogTimeBeforeTheOrderTime_IsAccepted() =>
        OfflineSyncWindow.CheckCatalogTime(Now.AddHours(-3), Now.AddHours(-1), Now).ShouldBeNull();

    [Fact]
    public void CatalogTimeWithoutAnOrderTime_IsComparedWithNow()
    {
        OfflineSyncWindow.CheckCatalogTime(Now.AddHours(-1), null, Now).ShouldBeNull();
        OfflineSyncWindow.CheckCatalogTime(Now.AddHours(1), null, Now).ShouldNotBeNull();
    }
}
