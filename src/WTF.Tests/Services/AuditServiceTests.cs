using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Services;

public class AuditServiceTests
{
    private readonly string _db = TestDb.NewName();

    private AuditService Service(IHttpContextAccessor accessor) => new(TestDb.Create(_db), accessor);

    private static IHttpContextAccessor WithIp(Guid userId, string? ip)
    {
        var accessor = TestRequest.As(userId);
        accessor.HttpContext!.Connection.RemoteIpAddress = ip is null ? null : IPAddress.Parse(ip);
        return accessor;
    }

    [Fact]
    public async Task LogAsync_ExplicitUser_WritesRowWithSerializedValuesAndIp()
    {
        var userId = Guid.NewGuid();
        var before = DateTime.UtcNow;

        await Service(WithIp(Guid.NewGuid(), "10.0.0.7")).LogAsync(
            AuditAction.ItemUpdated, AuditEntityType.Item, "item-1",
            oldValues: new { Name = "Old", IsActive = true },
            newValues: new { Name = "New", IsActive = false },
            userId: userId);

        await using var db = TestDb.Create(_db);
        var log = await db.AuditLogs.SingleAsync();
        log.UserId.ShouldBe(userId); // explicit id wins over the signed-in user
        log.Action.ShouldBe("ItemUpdated");
        log.EntityType.ShouldBe("Item");
        log.EntityId.ShouldBe("item-1");
        log.IpAddress.ShouldBe("10.0.0.7");
        log.Timestamp.ShouldBeGreaterThanOrEqualTo(before);

        // camelCase (web defaults) JSON
        JsonDocument.Parse(log.OldValues!).RootElement.GetProperty("name").GetString().ShouldBe("Old");
        JsonDocument.Parse(log.NewValues!).RootElement.GetProperty("isActive").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task LogAsync_NoValues_StoresNullOldAndNewValues()
    {
        await Service(WithIp(Guid.NewGuid(), null)).LogAsync(
            AuditAction.UserLogin, AuditEntityType.User, "u1", userId: Guid.NewGuid());

        await using var db = TestDb.Create(_db);
        var log = await db.AuditLogs.SingleAsync();
        log.OldValues.ShouldBeNull();
        log.NewValues.ShouldBeNull();
        log.IpAddress.ShouldBeNull();
    }

    [Fact]
    public async Task LogAsync_NoExplicitUser_UsesAuthenticatedRequestUser()
    {
        var userId = Guid.NewGuid();

        await Service(TestRequest.As(userId)).LogAsync(AuditAction.CustomerCreated, AuditEntityType.Customer, "c1");

        await using var db = TestDb.Create(_db);
        (await db.AuditLogs.SingleAsync()).UserId.ShouldBe(userId);
    }

    [Fact]
    public async Task LogAsync_NoUserAndNoRequest_WritesNothing()
    {
        await Service(TestRequest.None()).LogAsync(AuditAction.UserLogin, AuditEntityType.User, "u1");

        await using var db = TestDb.Create(_db);
        (await db.AuditLogs.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task LogAsync_UnauthenticatedRequest_WritesNothing()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity()) });

        await Service(accessor).LogAsync(AuditAction.UserLogin, AuditEntityType.User, "u1");

        await using var db = TestDb.Create(_db);
        (await db.AuditLogs.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task LogAsync_AuthenticatedWithoutValidIdClaim_WritesNothing()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "not-a-guid")], "test");
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        await Service(accessor).LogAsync(AuditAction.UserLogin, AuditEntityType.User, "u1");

        await using var db = TestDb.Create(_db);
        (await db.AuditLogs.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task LogAsync_ExplicitUserWithoutRequest_StillLogsWithNullIp()
    {
        var userId = Guid.NewGuid();

        await Service(TestRequest.None()).LogAsync(AuditAction.OrderCreated, AuditEntityType.Order, "o1", userId: userId);

        await using var db = TestDb.Create(_db);
        var log = await db.AuditLogs.SingleAsync();
        log.UserId.ShouldBe(userId);
        log.IpAddress.ShouldBeNull();
    }
}
