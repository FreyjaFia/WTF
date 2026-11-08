using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Tenancy;
using WTF.Domain.Tenancy;

namespace WTF.Tests.Tenancy;

public class CurrentTenantTests
{
    private static CurrentTenant Create(Guid? claim, bool legacyTokens = false, bool authenticated = true)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var identity = new ClaimsIdentity(claim is null ? [] : [new Claim(TenantDefaults.ClaimType, claim.ToString()!)], authenticated ? "test" : null);
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        return new CurrentTenant(Options.Create(new TenancyOptions { LegacyTokensAreDefaultTenant = legacyTokens }), accessor);
    }

    [Fact]
    public void UsesTheTokenTenant()
    {
        var id = Guid.NewGuid();
        var tenant = Create(id);

        tenant.FilterEnabled.ShouldBeTrue();
        tenant.TenantId.ShouldBe(id);
        tenant.StampTenantId.ShouldBe(id);
    }

    [Fact]
    public void WithoutAClaim_HasNoTenant()
    {
        var tenant = Create(null);

        tenant.FilterEnabled.ShouldBeTrue();
        tenant.TenantId.ShouldBeNull();
        tenant.StampTenantId.ShouldBeNull();
    }

    [Fact]
    public void SignedInTokenWithoutAClaim_IsTheFirstTenantWhileLegacyTokensAreAllowed()
    {
        var tenant = Create(null, legacyTokens: true);

        tenant.TenantId.ShouldBe(TenantDefaults.DefaultTenantId);
        tenant.StampTenantId.ShouldBe(TenantDefaults.DefaultTenantId);
    }

    [Fact]
    public void AnonymousCallerWithoutAClaim_HasNoTenantEvenWhenLegacyTokensAreAllowed()
    {
        var tenant = Create(null, legacyTokens: true, authenticated: false);

        tenant.TenantId.ShouldBeNull();
    }

    [Fact]
    public void Use_ChoosesTheTenantOfALinkOrJobOverTheToken()
    {
        var chosen = Guid.NewGuid();
        var tenant = Create(Guid.NewGuid());

        tenant.Use(chosen);

        tenant.TenantId.ShouldBe(chosen);
        tenant.StampTenantId.ShouldBe(chosen);
    }
}
