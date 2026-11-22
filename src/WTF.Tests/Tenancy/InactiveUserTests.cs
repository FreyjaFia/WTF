using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using WTF.Tests.Permissions;

namespace WTF.Tests.Tenancy;

public class InactiveUserTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task<(int Status, bool Reached)> SendAsync(string path, bool active)
    {
        TestDb.SeedSystemRoles(_dbName);
        await TestDb.SaveAsync(_dbName, new User
        {
            Id = _userId,
            Username = "cashier",
            FirstName = "Mia",
            LastName = "Santos",
            PasswordHash = "x",
            IsActive = active,
            RoleId = 2,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _userId,
        });

        var services = new ServiceCollection().AddScoped(_ => TestDb.Create(_dbName)).BuildServiceProvider();
        var context = new DefaultHttpContext
        {
            RequestServices = services,
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, _userId.ToString()), new Claim(ClaimTypes.Role, AppRoles.Cashier)], "test")),
        };
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();

        var reached = false;
        await new PermissionClaimsMiddleware(_ =>
        {
            reached = true;
            return Task.CompletedTask;
        }).InvokeAsync(context, new RolePermissionCache(TimeProvider.System), new AllFeatures());

        return (context.Response.StatusCode, reached);
    }

    [Fact]
    public async Task ADeactivatedUserWithAValidToken_IsSignedOut()
    {
        var (status, reached) = await SendAsync("/api/orders", active: false);

        reached.ShouldBeFalse();
        status.ShouldBe(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task ADeactivatedUser_CanStillLogOut()
    {
        var (_, reached) = await SendAsync("/api/auth/logout", active: false);

        reached.ShouldBeTrue();
    }

    [Fact]
    public async Task AnActiveUser_PassesThrough()
    {
        var (_, reached) = await SendAsync("/api/orders", active: true);

        reached.ShouldBeTrue();
    }
}
