using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class DeleteUserHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _actorId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _otherId = Guid.NewGuid();

    private async Task Seed()
    {
        await using var db = TestDb.Create(_dbName);
        foreach (var id in new[] { _userId, _otherId })
        {
            db.Users.Add(new User
            {
                Id = id, Username = id == _userId ? "target" : "other", FirstName = "F", LastName = "L", PasswordHash = "h",
                IsActive = true, RoleId = 2, CreatedAt = DateTime.UtcNow
            });
        }
        db.RefreshTokens.Add(Token(_userId, "u1"));
        db.RefreshTokens.Add(Token(_userId, "u2"));
        db.RefreshTokens.Add(Token(_otherId, "o1"));
        await db.SaveChangesAsync();
    }

    private static RefreshToken Token(Guid userId, string value) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, Token = value, CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1)
    };

    private DeleteUserHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_actorId), _audit);

    [Fact]
    public async Task Handle_ExistingUser_DeactivatesInsteadOfRemoving()
    {
        await Seed();

        var ok = await Handler().Handle(new DeleteUserCommand(_userId), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var user = await db.Users.SingleAsync(u => u.Id == _userId);
        user.IsActive.ShouldBeFalse();
        user.UpdatedBy.ShouldBe(_actorId);
        user.UpdatedAt.ShouldNotBeNull();
        (await db.Users.CountAsync()).ShouldBe(2);
        (await db.Users.SingleAsync(u => u.Id == _otherId)).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_ExistingUser_RevokesOnlyThatUsersSessions()
    {
        await Seed();

        await Handler().Handle(new DeleteUserCommand(_userId), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.Where(t => t.UserId == _userId).AllAsync(t => t.IsRevoked)).ShouldBeTrue();
        (await db.RefreshTokens.SingleAsync(t => t.UserId == _otherId)).IsRevoked.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ExistingUser_AuditsOldAndNewActiveFlag()
    {
        await Seed();

        await Handler().Handle(new DeleteUserCommand(_userId), CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.UserDeleted, AuditEntityType.User, _userId.ToString(),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("IsActive = True")),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("IsActive = False")),
            _actorId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsFalseAndChangesNothing()
    {
        await Seed();

        var ok = await Handler().Handle(new DeleteUserCommand(Guid.NewGuid()), CancellationToken.None);

        ok.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        (await db.Users.CountAsync(u => u.IsActive)).ShouldBe(2);
        (await db.RefreshTokens.CountAsync(t => t.IsRevoked)).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
