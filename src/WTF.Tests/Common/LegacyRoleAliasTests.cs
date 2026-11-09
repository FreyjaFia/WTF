using Shouldly;
using System.Security.Claims;
using WTF.Api.Common.Auth;

namespace WTF.Tests.Common;

public class LegacyRoleAliasTests
{
    [Fact]
    public void Apply_TokenWithSuperAdmin_AlsoGetsOwner()
    {
        var principal = PrincipalWithRole("SuperAdmin");

        LegacyRoleAlias.Apply(principal);

        principal.IsInRole(AppRoles.Owner).ShouldBeTrue();
        principal.IsInRole("SuperAdmin").ShouldBeTrue();
    }

    [Fact]
    public void Apply_TokenWithOwner_IsUnchanged()
    {
        var principal = PrincipalWithRole(AppRoles.Owner);

        LegacyRoleAlias.Apply(principal);

        principal.FindAll(ClaimTypes.Role).Count().ShouldBe(1);
    }

    [Fact]
    public void Apply_OtherRole_GetsNothingExtra()
    {
        var principal = PrincipalWithRole(AppRoles.Admin);

        LegacyRoleAlias.Apply(principal);

        principal.IsInRole(AppRoles.Owner).ShouldBeFalse();
    }

    [Fact]
    public void Apply_NullPrincipal_DoesNothing()
    {
        Should.NotThrow(() => LegacyRoleAlias.Apply(null));
    }

    private static ClaimsPrincipal PrincipalWithRole(string role)
    {
        return new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
    }
}
