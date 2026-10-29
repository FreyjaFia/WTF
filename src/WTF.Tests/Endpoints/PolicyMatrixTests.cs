using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using WTF.Api.Common.Auth;

namespace WTF.Tests.Endpoints;

/// <summary>Which roles each authorization policy admits, evaluated by the real authorization service.</summary>
public class PolicyMatrixTests : IDisposable
{
    private static readonly string[] AllRoles =
        [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier, AppRoles.ItemManager, AppRoles.StockManager];

    // Policy -> roles allowed. Kept independent of AppAuthorizationExtensions on purpose.
    private static readonly Dictionary<string, string[]> Expected = new()
    {
        [AppPolicies.ProductsRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier],
        [AppPolicies.ProductsWrite] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.UsersRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
        [AppPolicies.UsersWrite] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.PromotionsRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
        [AppPolicies.PromotionsWrite] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.AuditRead] = [AppRoles.SuperAdmin],
        [AppPolicies.SchemaScriptHistoryRead] = [AppRoles.SuperAdmin],
        [AppPolicies.OrdersRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier],
        [AppPolicies.OrdersWrite] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
        [AppPolicies.OrdersOverride] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.OrderLinksManage] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
        [AppPolicies.CustomersRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier],
        [AppPolicies.CustomersWrite] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.Cashier],
        [AppPolicies.ItemsRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.ItemManager, AppRoles.StockManager],
        [AppPolicies.ItemsWrite] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.ItemManager],
        [AppPolicies.StockMovementsRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager],
        [AppPolicies.StockMovementsWrite] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.StockManager],
        [AppPolicies.StockWasteWrite] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.StockManager, AppRoles.Cashier],
        [AppPolicies.StockWasteReview] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.WasteReasonsManage] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.WasteReasonsRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager, AppRoles.Cashier],
        [AppPolicies.DashboardRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
        [AppPolicies.ReportsGenerate] = [AppRoles.SuperAdmin, AppRoles.Admin],
        [AppPolicies.ReportsRead] = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer],
    };

    private readonly EndpointTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private static ClaimsPrincipal UserWithRoles(params string[] roles) =>
        new(new ClaimsIdentity(roles.Select(r => new Claim(ClaimTypes.Role, r)), "test"));

    private async Task<bool> IsAllowedAsync(string policy, ClaimsPrincipal user)
    {
        var authorization = _host.App.Services.GetRequiredService<IAuthorizationService>();
        return (await authorization.AuthorizeAsync(user, null, policy)).Succeeded;
    }

    public static TheoryData<string> Policies()
    {
        var data = new TheoryData<string>();
        foreach (var policy in Expected.Keys)
        {
            data.Add(policy);
        }

        return data;
    }

    [Fact]
    public void EveryAppPolicyHasAnExpectation()
    {
        var defined = typeof(AppPolicies).GetFields().Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!);

        defined.Except(Expected.Keys).ShouldBeEmpty();
        Expected.Keys.Except(defined).ShouldBeEmpty();
    }

    [Theory]
    [MemberData(nameof(Policies))]
    public async Task Policy_AdmitsExactlyTheExpectedRoles(string policy)
    {
        foreach (var role in AllRoles)
        {
            var allowed = await IsAllowedAsync(policy, UserWithRoles(role));

            allowed.ShouldBe(Expected[policy].Contains(role), $"{policy} for {role}");
        }
    }

    [Theory]
    [MemberData(nameof(Policies))]
    public async Task Policy_DeniesUsersWithNoRolesOrAnUnknownRole(string policy)
    {
        (await IsAllowedAsync(policy, UserWithRoles())).ShouldBeFalse();
        (await IsAllowedAsync(policy, UserWithRoles("Stranger"))).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Policies))]
    public async Task Policy_DeniesAnonymousUsers(string policy)
    {
        (await IsAllowedAsync(policy, new ClaimsPrincipal(new ClaimsIdentity()))).ShouldBeFalse();
    }

    [Theory]
    [MemberData(nameof(Policies))]
    public async Task Policy_AdmitsAUserHoldingAnAllowedRoleAmongOthers(string policy)
    {
        var user = UserWithRoles("Stranger", Expected[policy][0]);

        (await IsAllowedAsync(policy, user)).ShouldBeTrue();
    }

    [Fact]
    public void SuperAdmin_IsAllowedEverywhere()
    {
        Expected.Values.ShouldAllBe(roles => roles.Contains(AppRoles.SuperAdmin));
    }

    [Fact]
    public void WritePolicies_NeverAdmitAdminViewer()
    {
        Expected.Where(p => p.Key.EndsWith("Write", StringComparison.Ordinal) || p.Key == AppPolicies.OrdersOverride || p.Key == AppPolicies.ReportsGenerate)
            .ShouldAllBe(p => !p.Value.Contains(AppRoles.AdminViewer));
    }
}
