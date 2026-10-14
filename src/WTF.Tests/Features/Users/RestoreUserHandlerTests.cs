using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class RestoreUserHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _actorId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task Seed(bool active = false)
    {
        await using var db = TestDb.Create(_dbName);
        db.Users.Add(new User
        {
            Id = _userId,
            Username = "target",
            FirstName = "F",
            LastName = "L",
            PasswordHash = "h",
            IsActive = active,
            RoleId = 2,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private RestoreUserHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_actorId), _audit);

    [Fact]
    public async Task Handle_InactiveUser_IsReactivatedAndAudited()
    {
        await Seed();

        var ok = await Handler().Handle(new RestoreUserCommand(_userId), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var user = await db.Users.SingleAsync();
        user.IsActive.ShouldBeTrue();
        user.UpdatedBy.ShouldBe(_actorId);
        user.UpdatedAt.ShouldNotBeNull();
        user.PasswordHash.ShouldBe("h");
        await _audit.Received(1).LogAsync(
            AuditAction.UserRestored, AuditEntityType.User, _userId.ToString(),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("IsActive = False")),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("IsActive = True")),
            _actorId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_AlreadyActiveUser_StaysActiveAndReturnsTrue()
    {
        await Seed(active: true);

        var ok = await Handler().Handle(new RestoreUserCommand(_userId), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsFalseWithoutAudit()
    {
        await Seed();

        var ok = await Handler().Handle(new RestoreUserCommand(Guid.NewGuid()), CancellationToken.None);

        ok.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).IsActive.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
