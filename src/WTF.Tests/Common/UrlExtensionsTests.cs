using Microsoft.AspNetCore.Http;
using NSubstitute;
using WTF.Api.Common.Extensions;

namespace WTF.Tests.Common;

public class UrlExtensionsTests
{
    private static IHttpContextAccessor AccessorFor(string scheme, string host)
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = scheme;
        context.Request.Host = new HostString(host);
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(context);
        return accessor;
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ToAbsoluteUrl_NullOrBlank_ReturnsNull(string? value)
    {
        UrlExtensions.ToAbsoluteUrl(AccessorFor("https", "example.com"), value).ShouldBeNull();
    }

    [Fact]
    public void ToAbsoluteUrl_AlreadyAbsolute_ReturnsUnchanged()
    {
        UrlExtensions.ToAbsoluteUrl(AccessorFor("https", "example.com"), "https://cdn.test/a.png")
            .ShouldBe("https://cdn.test/a.png");
    }

    [Fact]
    public void ToAbsoluteUrl_NoHttpContext_ReturnsOriginalRelativeValue()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);

        UrlExtensions.ToAbsoluteUrl(accessor, "/images/a.png").ShouldBe("/images/a.png");
    }

    [Fact]
    public void ToAbsoluteUrl_NullAccessor_ReturnsOriginalRelativeValue()
    {
        UrlExtensions.ToAbsoluteUrl(null, "images/a.png").ShouldBe("images/a.png");
    }

    [Theory]
    [InlineData("/images/a.png")]
    [InlineData("images/a.png")]
    public void ToAbsoluteUrl_Relative_PrefixesSchemeAndHost(string relative)
    {
        UrlExtensions.ToAbsoluteUrl(AccessorFor("https", "example.com:5001"), relative)
            .ShouldBe("https://example.com:5001/images/a.png");
    }
}
