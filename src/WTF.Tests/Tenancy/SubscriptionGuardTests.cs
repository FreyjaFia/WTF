using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Tenancy;

public class SubscriptionGuardTests
{
    private static readonly Guid Shop = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static async Task<(int Status, bool Reached)> SendAsync(
        string method, string path, DateTime? periodEnd, int grace = 7, bool multi = true, byte status = TenantAccess.Active)
    {
        var dbName = TestDb.NewName();
        await TestDb.SaveAsync(dbName, new Tenant { Id = Shop, Name = "S", Slug = "s", Status = status, CreatedAt = DateTime.UtcNow });
        if (periodEnd is { } end)
        {
            await TestDb.SaveAsync(dbName, new TenantSubscription
            {
                TenantId = Shop,
                PlanId = 1,
                CurrentPeriodStart = end.AddMonths(-1),
                CurrentPeriodEnd = end,
                GraceDays = grace
            });
        }

        var services = new ServiceCollection()
            .AddSingleton(TestDb.Create(dbName))
            .AddSingleton(Substitute.For<IPlatformAuditService>())
            .BuildServiceProvider();

        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Role, AppRoles.Admin), new Claim(TenantDefaults.ClaimType, Shop.ToString())], "test"));

        var reached = false;
        var middleware = new TenantRequestGuardMiddleware(_ =>
        {
            reached = true;
            return Task.CompletedTask;
        });

        var gate = new TenancyGate(Options.Create(new TenancyOptions { Mode = multi ? TenancyOptions.MultiMode : TenancyOptions.SingleMode }));
        await middleware.InvokeAsync(context, new TenantStatusCache(TimeProvider.System), gate);
        return (context.Response.StatusCode, reached);
    }

    private static readonly DateTime Lapsed = DateTime.UtcNow.AddDays(-30);

    [Fact]
    public async Task PaidShop_CanWrite()
    {
        var (_, reached) = await SendAsync("POST", "/api/orders", DateTime.UtcNow.AddDays(10));

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task ShopInItsGrace_CanStillWrite()
    {
        var (_, reached) = await SendAsync("POST", "/api/orders", DateTime.UtcNow.AddDays(-3));

        reached.ShouldBeTrue();
    }

    [Theory]
    [InlineData("POST", "/api/orders")]
    [InlineData("PUT", "/api/products/1")]
    [InlineData("DELETE", "/api/customers/1")]
    public async Task LapsedShop_CannotSaveAnything(string method, string path)
    {
        var (status, reached) = await SendAsync(method, path, Lapsed);

        status.ShouldBe(StatusCodes.Status402PaymentRequired);
        reached.ShouldBeFalse();
    }

    [Theory]
    [InlineData("GET", "/api/orders")]
    [InlineData("GET", "/api/subscription")]
    [InlineData("POST", "/api/auth/refresh")]
    [InlineData("POST", "/api/auth/logout")]
    public async Task LapsedShop_CanStillReadSignInAndSeeItsSubscription(string method, string path)
    {
        var (status, reached) = await SendAsync(method, path, Lapsed);

        reached.ShouldBeTrue();
        status.ShouldNotBe(StatusCodes.Status402PaymentRequired);
    }

    [Theory]
    [InlineData("/api/orders/sync")]
    [InlineData("/api/orders/batch")]
    public async Task LapsedShop_StillReceivesOfflineOrderSync(string path)
    {
        var (_, reached) = await SendAsync("POST", path, Lapsed);

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task SuspendedShop_StillReceivesOfflineOrderSync()
    {
        var (_, reached) = await SendAsync("POST", "/api/orders/sync", Lapsed, status: TenantAccess.Suspended);

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task ShopWithoutASubscription_IsNeverLocked()
    {
        var (_, reached) = await SendAsync("POST", "/api/orders", periodEnd: null);

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task SingleShopInstall_IsNeverLockedBySubscription()
    {
        var (_, reached) = await SendAsync("POST", "/api/orders", Lapsed, multi: false);

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task SuspendedShop_StillGets403_BeforeThePaymentCheck()
    {
        var (status, _) = await SendAsync("POST", "/api/orders", Lapsed, status: TenantAccess.Suspended);

        status.ShouldBe(StatusCodes.Status403Forbidden);
    }
}
