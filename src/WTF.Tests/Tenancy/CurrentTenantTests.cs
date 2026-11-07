using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Tenancy;
using WTF.Domain.Tenancy;

namespace WTF.Tests.Tenancy;

public class CurrentTenantTests
{
    private static CurrentTenant Create(string mode, Guid? claim)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var identity = new ClaimsIdentity(claim is null ? [] : [new Claim(TenantDefaults.ClaimType, claim.ToString()!)], "test");
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        return new CurrentTenant(Options.Create(new TenancyOptions { Mode = mode }), accessor);
    }

    [Fact]
    public void Single_DoesNotFilterAndStampsTheDefaultTenant()
    {
        var tenant = Create("Single", Guid.NewGuid());

        tenant.FilterEnabled.ShouldBeFalse();
        tenant.TenantId.ShouldBeNull();
        tenant.StampTenantId.ShouldBe(TenantDefaults.DefaultTenantId);
    }

    [Fact]
    public void Multi_UsesTheTokenTenant()
    {
        var id = Guid.NewGuid();
        var tenant = Create("multi", id);

        tenant.FilterEnabled.ShouldBeTrue();
        tenant.TenantId.ShouldBe(id);
        tenant.StampTenantId.ShouldBe(id);
    }

    [Fact]
    public void Multi_WithoutAClaim_HasNoTenant()
    {
        var tenant = Create("Multi", null);

        tenant.FilterEnabled.ShouldBeTrue();
        tenant.TenantId.ShouldBeNull();
        tenant.StampTenantId.ShouldBeNull();
    }

    [Fact]
    public void DefaultMode_IsSingle()
    {
        new TenancyOptions().IsMulti.ShouldBeFalse();
    }
}
