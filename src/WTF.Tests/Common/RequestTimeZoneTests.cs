using Microsoft.AspNetCore.Http;
using NSubstitute;
using WTF.Api.Common.Time;

namespace WTF.Tests.Common;

public class RequestTimeZoneTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Resolve_NullOrBlank_ReturnsUtc(string? id)
    {
        RequestTimeZone.Resolve(id).ShouldBe(TimeZoneInfo.Utc);
    }

    [Fact]
    public void Resolve_UnknownId_ReturnsUtc()
    {
        RequestTimeZone.Resolve("Not/AZone").ShouldBe(TimeZoneInfo.Utc);
    }

    [Theory]
    [InlineData("Asia/Manila")]
    [InlineData("Singapore Standard Time")]
    public void Resolve_IanaOrWindowsId_ReturnsOffsetPlusEight(string id)
    {
        RequestTimeZone.Resolve(id).BaseUtcOffset.ShouldBe(TimeSpan.FromHours(8));
    }

    [Fact]
    public void ResolveFromRequest_HeaderPresent_UsesHeader()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-TimeZone"] = "Asia/Manila";
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(context);

        RequestTimeZone.ResolveFromRequest(accessor).BaseUtcOffset.ShouldBe(TimeSpan.FromHours(8));
    }

    [Fact]
    public void ResolveFromRequest_NoContext_ReturnsUtc()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);

        RequestTimeZone.ResolveFromRequest(accessor).ShouldBe(TimeZoneInfo.Utc);
    }

    [Fact]
    public void ToLocalIso_ConvertsUtcToZoneWithOffset()
    {
        var zone = RequestTimeZone.Resolve("Asia/Manila");
        var utc = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var iso = RequestTimeZone.ToLocalIso(utc, zone);

        iso.ShouldStartWith("2025-01-01T08:00:00");
        iso.ShouldEndWith("+08:00");
    }

    [Fact]
    public void ToLocalIso_UnspecifiedKind_TreatedAsUtc()
    {
        var value = new DateTime(2025, 1, 1, 12, 0, 0, DateTimeKind.Unspecified);

        RequestTimeZone.ToLocalIso(value, TimeZoneInfo.Utc).ShouldStartWith("2025-01-01T12:00:00");
    }
}
