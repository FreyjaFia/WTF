using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class LogoutHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task Seed()
    {
        await using var db = TestDb.Create(_dbName);
        db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = _userId, Token = "t1", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
        db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = _userId, Token = "t2", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Handle_KnownToken_RevokesOnlyThatTokenAndAudits()
    {
        await Seed();

        var ok = await new LogoutHandler(TestDb.Create(_dbName), _audit).Handle(new LogoutCommand("t1"), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.SingleAsync(t => t.Token == "t1")).IsRevoked.ShouldBeTrue();
        (await db.RefreshTokens.SingleAsync(t => t.Token == "t2")).IsRevoked.ShouldBeFalse();
        await _audit.Received(1).LogAsync(
            AuditAction.UserLogout, AuditEntityType.User, _userId.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownToken_ReturnsFalseWithoutAudit()
    {
        await Seed();

        var ok = await new LogoutHandler(TestDb.Create(_dbName), _audit).Handle(new LogoutCommand("nope"), CancellationToken.None);

        ok.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync(t => t.IsRevoked)).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_AlreadyRevokedToken_StaysRevokedAndReturnsTrue()
    {
        await Seed();

        await new LogoutHandler(TestDb.Create(_dbName), _audit).Handle(new LogoutCommand("t1"), CancellationToken.None);
        var again = await new LogoutHandler(TestDb.Create(_dbName), _audit).Handle(new LogoutCommand("t1"), CancellationToken.None);

        again.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.SingleAsync(t => t.Token == "t1")).IsRevoked.ShouldBeTrue();
    }
}
