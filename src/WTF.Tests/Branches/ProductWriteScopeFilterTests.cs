using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Products;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class ProductWriteScopeFilterTests
{
    private static readonly Guid Tenant = TenantDefaults.DefaultTenantId;

    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _makati;
    private readonly Guid _cebu = Guid.NewGuid();
    private readonly Guid _everywhere = Guid.NewGuid();
    private readonly Guid _cebuOnly = Guid.NewGuid();

    public ProductWriteScopeFilterTests()
    {
        using var db = TestDb.Create(_dbName);
        _makati = db.Branches.Single(b => b.IsMain).Id;
        db.Branches.Add(new Branch { Id = _cebu, TenantId = Tenant, Name = "Cebu", Code = "CEB", TimeZone = "Asia/Manila", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.Products.AddRange(NewProduct(_everywhere, "Latte"), NewProduct(_cebuOnly, "Halo-halo"));
        db.ProductBranches.Add(new ProductBranch { ProductId = _cebuOnly, BranchId = _cebu, TenantId = Tenant });
        db.SaveChanges();
    }

    private static Product NewProduct(Guid id, string name) => new()
    {
        Id = id,
        Name = name,
        Code = name.ToUpperInvariant(),
        Price = 100m,
        IsActive = true,
        CategoryId = 1,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = Guid.NewGuid(),
    };

    private async Task<(bool Reached, int? Status)> RunAsync(FixedBranch branch, Guid productId, params string[] permissions)
    {
        var claims = new List<Claim> { new(PermissionClaimsMiddleware.ResolvedClaim, "1") };
        claims.AddRange(permissions.Select(p => new Claim(PermissionClaimsMiddleware.PermissionClaim, p)));

        var services = new ServiceCollection().AddLogging().AddSingleton(TestDb.Create(_dbName, NoTenant.Instance, branch)).BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services, User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
        http.Request.RouteValues["id"] = productId.ToString();
        http.Response.Body = new MemoryStream();

        var reached = false;
        var result = await new ProductWriteScopeFilter("id").InvokeAsync(
            new DefaultEndpointFilterInvocationContext(http),
            _ =>
            {
                reached = true;
                return ValueTask.FromResult<object?>(Results.Ok());
            });

        if (!reached && result is IResult denied)
        {
            await denied.ExecuteAsync(http);
        }

        return (reached, reached ? null : http.Response.StatusCode);
    }

    [Fact]
    public async Task ALimitedPerson_WithProductsWriteButNoBranchKey_IsRefused()
    {
        var (reached, status) = await RunAsync(new FixedBranch([_makati], _makati, true), _everywhere, "products.write");

        reached.ShouldBeFalse();
        status.ShouldBe(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task ALimitedPerson_WithTheBranchKey_ChangesAProductLimitedToTheirBranches()
    {
        var (reached, _) = await RunAsync(new FixedBranch([_cebu], _cebu, true), _cebuOnly, PermissionKeys.ProductsWriteBranch);

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task ALimitedPerson_WithTheBranchKey_CannotChangeAShopWideProduct()
    {
        var (reached, status) = await RunAsync(new FixedBranch([_cebu], _cebu, true), _everywhere, PermissionKeys.ProductsWriteBranch);

        reached.ShouldBeFalse();
        status.ShouldBe(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task APersonWhoWorksInEveryBranch_WithProductsWrite_ChangesAnyProduct()
    {
        var (reached, _) = await RunAsync(new FixedBranch([_makati, _cebu], null, false), _everywhere, "products.write");

        reached.ShouldBeTrue();
    }
}
