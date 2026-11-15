using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Domain.Tenancy;

namespace WTF.Tests.Tenancy;

public class TenantTokenRuleTests
{
    private static ClaimsPrincipal Principal(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, "test", ClaimTypes.Name, ClaimTypes.Role));

    [Fact]
    public void ShopToken_WithATenantClaim_IsAccepted()
    {
        var user = Principal(new Claim(ClaimTypes.Role, AppRoles.Owner), new Claim(TenantDefaults.ClaimType, Guid.NewGuid().ToString()));

        TenantTokenRule.IsAccepted(user).ShouldBeTrue();
    }

    [Theory]
    [InlineData(AppRoles.Owner)]
    [InlineData(AppRoles.Admin)]
    [InlineData(AppRoles.Cashier)]
    public void ShopToken_WithoutATenantClaim_IsRefused(string role)
    {
        TenantTokenRule.IsAccepted(Principal(new Claim(ClaimTypes.Role, role))).ShouldBeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void ShopToken_WithABrokenTenantClaim_IsRefused(string value)
    {
        var user = Principal(new Claim(ClaimTypes.Role, AppRoles.Owner), new Claim(TenantDefaults.ClaimType, value));

        TenantTokenRule.IsAccepted(user).ShouldBeFalse();
    }

    [Fact]
    public void PlatformAdminToken_LivesOutsideShops_AndIsAccepted()
    {
        TenantTokenRule.IsAccepted(Principal(new Claim(ClaimTypes.Role, AppRoles.PlatformAdmin))).ShouldBeTrue();
    }
}
