using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using NSubstitute;
using WTF.Api.Common.Auth;

namespace WTF.Tests.Infrastructure;

/// <summary>Builds the pieces of an HTTP request that handlers read: the signed-in user and the time zone header.</summary>
internal static class TestRequest
{
    /// <summary>An accessor whose current user has the given id and roles, and optionally an X-TimeZone header.</summary>
    public static IHttpContextAccessor As(Guid userId, string role = AppRoles.Admin, string? timeZone = null)
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Role, role),
        ], "test");

        var context = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
        if (timeZone is not null)
        {
            context.Request.Headers["X-TimeZone"] = timeZone;
        }

        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(context);
        return accessor;
    }

    /// <summary>An accessor with no current request (background work, scheduled jobs).</summary>
    public static IHttpContextAccessor None()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);
        return accessor;
    }
}
