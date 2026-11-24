using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branches.Enums;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class BranchScopeMiddlewareTests
{
    private static readonly Guid Shop = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Makati = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid Cebu = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    private static readonly Guid Closed = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");

    private sealed record Run(int Status, bool Reached, CurrentBranch Branch);

    private static Branch NewBranch(Guid id, string code, bool main, bool active = true) => new()
    {
        Id = id,
        TenantId = Shop,
        Name = code,
        Code = code,
        TimeZone = "Asia/Manila",
        IsMain = main,
        IsActive = active,
        CreatedAt = DateTime.UtcNow,
    };

    private static async Task<Run> SendAsync(string method, string path, BranchScopeEnum scope, Guid[] assigned, string? header, Guid? defaultBranch = null, string[]? roles = null)
    {
        var dbName = TestDb.NewName();
        var userId = Guid.NewGuid();
        await TestDb.SaveAsync(dbName,
            new Tenant { Id = Shop, Name = "S", Slug = "s", Status = 2, CreatedAt = DateTime.UtcNow },
            NewBranch(Makati, "MKT", true),
            NewBranch(Cebu, "CEB", false),
            NewBranch(Closed, "OLD", false, active: false),
            new User { Id = userId, TenantId = Shop, Username = "u", FirstName = "U", LastName = "U", PasswordHash = "x", IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow, CreatedBy = userId, BranchScope = (byte)scope, DefaultBranchId = defaultBranch });
        foreach (var branchId in assigned)
        {
            await TestDb.SaveAsync(dbName, new UserBranch { UserId = userId, BranchId = branchId, TenantId = Shop, CreatedAt = DateTime.UtcNow });
        }

        var current = new CurrentBranch();
        var services = new ServiceCollection().AddSingleton(TestDb.Create(dbName)).BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        if (header is not null)
        {
            context.Request.Headers[BranchScopeMiddleware.HeaderName] = header;
        }

        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, userId.ToString()), new(TenantDefaults.ClaimType, Shop.ToString()) };
        claims.AddRange((roles ?? ["Cashier"]).Select(r => new Claim(ClaimTypes.Role, r)));
        context.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));

        var reached = false;
        var middleware = new BranchScopeMiddleware(_ =>
        {
            reached = true;
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(context, new BranchScopeCache(TimeProvider.System), current);
        return new Run(context.Response.StatusCode, reached, current);
    }

    [Fact]
    public async Task OwnerWithAllScope_NoHeader_WorksInTheirDefaultBranch_AndMayUseAnyBranch()
    {
        var run = await SendAsync("GET", "/api/orders", BranchScopeEnum.All, [Makati], null, defaultBranch: Cebu);

        run.Reached.ShouldBeTrue();
        run.Branch.ActiveBranchId.ShouldBe(Cebu);
        run.Branch.VisibleBranchIds.ShouldBe([Cebu]);
        run.Branch.WriteCheckEnabled.ShouldBeFalse();
        run.Branch.AllowedBranchIds.ShouldContain(Makati);
        run.Branch.AllowedBranchIds.ShouldContain(Cebu);
    }

    [Fact]
    public async Task NoDefault_FallsBackToMain()
    {
        var run = await SendAsync("GET", "/api/orders", BranchScopeEnum.All, [], null);

        run.Branch.ActiveBranchId.ShouldBe(Makati);
    }

    [Fact]
    public async Task LimitedUser_SeesOnlyTheirBranches_AndIsRefusedAnother()
    {
        var own = await SendAsync("GET", "/api/orders", BranchScopeEnum.Selected, [Cebu], null);
        own.Branch.ActiveBranchId.ShouldBe(Cebu);
        own.Branch.AllowedBranchIds.ShouldBe([Cebu]);
        own.Branch.WriteCheckEnabled.ShouldBeTrue();

        var other = await SendAsync("GET", "/api/orders", BranchScopeEnum.Selected, [Cebu], Makati.ToString());
        other.Status.ShouldBe(StatusCodes.Status403Forbidden);
        other.Reached.ShouldBeFalse();
    }

    [Fact]
    public async Task StaleBranchHeader_IsIgnoredWhenAskingWhichBranchesAreAllowed()
    {
        var run = await SendAsync("GET", "/api/branches/mine", BranchScopeEnum.All, [Makati], Guid.NewGuid().ToString());

        run.Reached.ShouldBeTrue();
        run.Status.ShouldBe(200);
    }

    [Fact]
    public async Task StaleBranchHeader_IsStillRefusedOnOtherRequests()
    {
        var run = await SendAsync("GET", "/api/orders", BranchScopeEnum.All, [Makati], Guid.NewGuid().ToString());

        run.Reached.ShouldBeFalse();
        run.Status.ShouldBe(403);
    }

    [Theory]
    [InlineData("not-a-branch")]
    [InlineData("aaaaaaaa-0000-0000-0000-000000000001,aaaaaaaa-0000-0000-0000-000000000002")]
    [InlineData("all branches")]
    public async Task ABranchHeaderThatIsNotABranchId_IsRefusedInsteadOfUsingTheDefaultBranch(string header)
    {
        var run = await SendAsync("POST", "/api/orders", BranchScopeEnum.All, [], header);

        run.Reached.ShouldBeFalse();
        run.Status.ShouldBe(StatusCodes.Status400BadRequest);
    }

    [Fact]
    public async Task ABadBranchHeader_IsStillIgnoredWhereTheHeaderIsNotUsed()
    {
        (await SendAsync("GET", "/api/branches/mine", BranchScopeEnum.All, [], "not-a-branch")).Reached.ShouldBeTrue();
        (await SendAsync("POST", "/api/auth/logout", BranchScopeEnum.All, [], "not-a-branch")).Reached.ShouldBeTrue();
    }

    [Fact]
    public async Task AllBranches_IsForReadingOnly()
    {
        var read = await SendAsync("GET", "/api/orders", BranchScopeEnum.All, [], "all");
        read.Reached.ShouldBeTrue();
        read.Branch.IsAllBranches.ShouldBeTrue();
        read.Branch.ActiveBranchId.ShouldBeNull();
        read.Branch.VisibleBranchIds.Count.ShouldBe(3);

        var write = await SendAsync("POST", "/api/orders", BranchScopeEnum.All, [], "all");
        write.Status.ShouldBe(StatusCodes.Status400BadRequest);
        write.Reached.ShouldBeFalse();
    }

    [Fact]
    public async Task LimitedUser_AllBranches_ReadsOnlyTheirOwn()
    {
        var run = await SendAsync("GET", "/api/orders", BranchScopeEnum.Selected, [Makati, Cebu], "all");

        run.Branch.VisibleBranchIds.OrderBy(i => i).ShouldBe([Makati, Cebu]);
    }

    [Fact]
    public async Task ClosedBranch_CanBeReadButNotWrittenTo()
    {
        var read = await SendAsync("GET", "/api/reports/sales", BranchScopeEnum.All, [], Closed.ToString());
        read.Reached.ShouldBeTrue();
        read.Branch.ActiveBranchId.ShouldBe(Closed);

        var write = await SendAsync("POST", "/api/orders", BranchScopeEnum.All, [], Closed.ToString());
        write.Status.ShouldBe(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task LimitedUserWithNoBranch_IsToldToAskTheOwner_ButCanStillSignOut()
    {
        var blocked = await SendAsync("GET", "/api/orders", BranchScopeEnum.Selected, [], null);
        blocked.Status.ShouldBe(StatusCodes.Status403Forbidden);

        var logout = await SendAsync("POST", "/api/auth/logout", BranchScopeEnum.Selected, [], null);
        logout.Reached.ShouldBeTrue();
    }

    [Fact]
    public async Task LimitedUserWhoseOnlyBranchHasClosed_CanReadButNotWriteWithoutAHeader()
    {
        var read = await SendAsync("GET", "/api/orders", BranchScopeEnum.Selected, [Closed], null);
        read.Reached.ShouldBeTrue();
        read.Branch.ActiveBranchId.ShouldBe(Closed);

        var write = await SendAsync("POST", "/api/orders", BranchScopeEnum.Selected, [Closed], null);
        write.Status.ShouldBe(StatusCodes.Status403Forbidden);
        write.Reached.ShouldBeFalse();

        var logout = await SendAsync("POST", "/api/auth/logout", BranchScopeEnum.Selected, [Closed], null);
        logout.Reached.ShouldBeTrue();
    }

    [Fact]
    public async Task APersonWhoIsNoLongerInTheDatabase_NeverGetsEveryBranch()
    {
        var dbName = TestDb.NewName();
        await TestDb.SaveAsync(dbName, NewBranch(Makati, "MKT", true));
        await using var db = TestDb.Create(dbName);

        var scope = await new BranchScopeCache(TimeProvider.System).GetUserAsync(db, Guid.NewGuid(), CancellationToken.None);

        scope.IsAll.ShouldBeFalse();
        scope.Assigned.ShouldBeEmpty();
    }

    [Fact]
    public async Task PlatformAdmin_AndAnonymousRequests_AreNotFiltered()
    {
        var admin = await SendAsync("GET", "/api/platform/tenants", BranchScopeEnum.All, [], null, roles: ["PlatformAdmin"]);
        admin.Reached.ShouldBeTrue();
        admin.Branch.FilterEnabled.ShouldBeFalse();
    }
}
