using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;

namespace WTF.Tests.Permissions;

public class PermissionRulesTests
{
    [Fact]
    public void Normalize_AddsEverythingAKeyRequires_AndDropsUnknownKeys()
    {
        PermissionRules.Normalize(["orders.override", "gone.forever"]).Order()
            .ShouldBe(["orders.override", "orders.read", "orders.write"]);
    }

    [Fact]
    public void Normalize_OfEveryCatalogKey_IsStable()
    {
        var all = PermissionCatalog.All.Select(p => p.Key).ToList();

        PermissionRules.Normalize(all).Order().ShouldBe(all.Order());
    }

    [Fact]
    public async Task Middleware_PutsTheLookedUpPermissionsOnTheRequest_AndIgnoresTheTokenRoleList()
    {
        var checks = PermissionChecks.ForPrincipal(Principal(AppRoles.Owner, ("perm_resolved", "1"), ("perm", "orders.read")));

        checks.ShouldBe(["orders.read"]);
        await Task.CompletedTask;
    }

    [Fact]
    public void WithoutALookup_ThePrincipalFallsBackToTheRoleBundle()
    {
        PermissionChecks.ForPrincipal(Principal(AppRoles.Cashier)).Order()
            .ShouldBe(SystemRolePermissions.Bundles[AppRoles.Cashier].Order());
        PermissionChecks.ForPrincipal(Principal("SuperAdmin")).ShouldBeEmpty();
    }

    [Fact]
    public void RolesManage_IsHeldByTheOwnerOnly()
    {
        SystemRolePermissions.RolesWith("roles.manage").ShouldBe([AppRoles.Owner]);
    }

    private static ClaimsPrincipal Principal(string role, params (string Type, string Value)[] extra)
    {
        var claims = new List<Claim> { new(ClaimTypes.Role, role) };
        claims.AddRange(extra.Select(e => new Claim(e.Type, e.Value)));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    [Fact]
    public async Task Middleware_GivesATokenNamingAMissingRole_NoPermissionsAtAll()
    {
        var name = Infrastructure.TestDb.NewName();
        Infrastructure.TestDb.SeedSystemRoles(name);
        var userId = Guid.NewGuid();
        await Infrastructure.TestDb.SaveAsync(name, new WTF.Domain.Entities.User
        {
            Id = userId,
            Username = "o",
            FirstName = "O",
            LastName = "O",
            PasswordHash = "x",
            IsActive = true,
            RoleId = 4,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
        });

        async Task<HashSet<string>> RunAsync(string tokenRole)
        {
            var services = new ServiceCollection()
                .AddScoped(_ => Infrastructure.TestDb.Create(name)).BuildServiceProvider();
            var context = new DefaultHttpContext
            {
                RequestServices = services,
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, tokenRole)], "test")),
            };

            await new PermissionClaimsMiddleware(_ => Task.CompletedTask).InvokeAsync(context, new RolePermissionCache(TimeProvider.System));
            return PermissionChecks.ForPrincipal(context.User);
        }

        (await RunAsync(AppRoles.Owner)).Count.ShouldBe(PermissionCatalog.All.Count);
        (await RunAsync("SuperAdmin")).ShouldBeEmpty();
    }
}
