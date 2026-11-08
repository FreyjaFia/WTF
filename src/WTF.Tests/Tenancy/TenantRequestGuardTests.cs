using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Platform;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

public class TenantRequestGuardTests
{
    private static readonly Guid Shop = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private sealed record Run(int Status, bool Reached, IPlatformAuditService Audit);

    private static async Task<Run> SendAsync(
        string method,
        string path,
        IEnumerable<Claim> claims,
        byte shopStatus = TenantAccess.Active,
        bool multi = true)
    {
        var dbName = TestDb.NewName();
        await TestDb.SaveAsync(dbName, new Tenant { Id = Shop, Name = "S", Slug = "s", Status = shopStatus, CreatedAt = DateTime.UtcNow });

        var audit = Substitute.For<IPlatformAuditService>();
        var services = new ServiceCollection()
            .AddSingleton(TestDb.Create(dbName))
            .AddSingleton(audit)
            .BuildServiceProvider();

        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));

        var reached = false;
        var middleware = new TenantRequestGuardMiddleware(_ =>
        {
            reached = true;
            return Task.CompletedTask;
        });

        var gate = new TenancyGate(Options.Create(new TenancyOptions { Mode = multi ? TenancyOptions.MultiMode : TenancyOptions.SingleMode }));
        await middleware.InvokeAsync(context, new TenantStatusCache(TimeProvider.System), gate);
        return new Run(context.Response.StatusCode, reached, audit);
    }

    private static Claim[] ShopUser() =>
    [
        new(ClaimTypes.Role, AppRoles.Admin),
        new(TenantDefaults.ClaimType, Shop.ToString()),
    ];

    private static Claim[] Impersonated(bool readOnly) =>
    [
        new(ClaimTypes.Role, AppRoles.SuperAdmin),
        new(TenantDefaults.ClaimType, Shop.ToString()),
        new(ImpersonationClaims.By, Guid.NewGuid().ToString()),
        new(ImpersonationClaims.ReadOnly, readOnly ? "1" : "0"),
    ];

    [Fact]
    public async Task ActiveShop_PassesThrough()
    {
        var run = await SendAsync("POST", "/api/orders", ShopUser());
        run.Reached.ShouldBeTrue();
    }

    [Theory]
    [InlineData(TenantAccess.Suspended)]
    [InlineData(TenantAccess.Cancelled)]
    public async Task SuspendedOrCancelledShop_IsRefused(byte status)
    {
        var run = await SendAsync("GET", "/api/orders", ShopUser(), status);
        run.Status.ShouldBe(StatusCodes.Status403Forbidden);
        run.Reached.ShouldBeFalse();
    }

    [Fact]
    public async Task SingleMode_DoesNotCheckTheShop()
    {
        var run = await SendAsync("GET", "/api/orders", ShopUser(), TenantAccess.Suspended, multi: false);
        run.Reached.ShouldBeTrue();
    }

    [Fact]
    public async Task ReadOnlyImpersonation_AllowsReadsAndRefusesWrites()
    {
        (await SendAsync("GET", "/api/orders", Impersonated(readOnly: true))).Reached.ShouldBeTrue();

        var write = await SendAsync("POST", "/api/orders", Impersonated(readOnly: true));
        write.Status.ShouldBe(StatusCodes.Status403Forbidden);
        write.Reached.ShouldBeFalse();
    }

    [Fact]
    public async Task WritableImpersonation_AuditsEveryChange_ButNeverTouchesAccountsOrPasswords()
    {
        var write = await SendAsync("PUT", "/api/orders/1", Impersonated(readOnly: false));
        write.Reached.ShouldBeTrue();
        await write.Audit.Received(1).LogAsync(PlatformActions.ImpersonatedAction, Shop, Arg.Any<string?>(), Arg.Any<Guid?>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());

        foreach (var path in new[] { "/api/auth/change-password", "/api/users/abc" })
        {
            var blocked = await SendAsync("POST", path, Impersonated(readOnly: false));
            blocked.Status.ShouldBe(StatusCodes.Status403Forbidden);
            blocked.Reached.ShouldBeFalse();
        }
    }

    [Fact]
    public async Task SuspendedShop_BlocksAnImpersonationTokenToo()
    {
        var run = await SendAsync("GET", "/api/orders", Impersonated(readOnly: true), TenantAccess.Suspended);
        run.Status.ShouldBe(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public void PlatformToken_IsNeverTreatedAsTheFirstShop()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var tenant = new CurrentTenant(Options.Create(new TenancyOptions { Mode = TenancyOptions.MultiMode, LegacyTokensAreDefaultTenant = true }), accessor);

        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.PlatformAdmin)], "test", ClaimTypes.Name, ClaimTypes.Role)),
        });
        tenant.TenantId.ShouldBeNull();

        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, AppRoles.Admin)], "test", ClaimTypes.Name, ClaimTypes.Role)),
        });
        tenant.TenantId.ShouldBe(TenantDefaults.DefaultTenantId);
    }
}
