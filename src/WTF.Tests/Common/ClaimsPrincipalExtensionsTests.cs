using System.Security.Claims;
using WTF.Api.Common.Extensions;

namespace WTF.Tests.Common;

public class ClaimsPrincipalExtensionsTests
{
    private static ClaimsPrincipal PrincipalWith(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, "test"));

    [Fact]
    public void GetUserId_ValidNameIdentifier_ReturnsGuid()
    {
        var id = Guid.NewGuid();
        var principal = PrincipalWith(new Claim(ClaimTypes.NameIdentifier, id.ToString()));

        principal.GetUserId().ShouldBe(id);
    }

    [Fact]
    public void GetUserId_MissingClaim_Throws()
    {
        Should.Throw<UnauthorizedAccessException>(() => PrincipalWith().GetUserId());
    }

    [Fact]
    public void GetUserId_NonGuidClaim_Throws()
    {
        var principal = PrincipalWith(new Claim(ClaimTypes.NameIdentifier, "not-a-guid"));

        Should.Throw<UnauthorizedAccessException>(() => principal.GetUserId());
    }
}
