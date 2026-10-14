using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Users;

public class UpdateUserHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _actorId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();
    private string _originalHash = string.Empty;

    private async Task Seed()
    {
        _originalHash = BCrypt.Net.BCrypt.HashPassword("original-pw");
        await using var db = TestDb.Create(_dbName);
        db.Users.Add(new User
        {
            Id = _userId,
            Username = "old",
            FirstName = "Old",
            LastName = "Name",
            PasswordHash = _originalHash,
            IsActive = true,
            RoleId = (int)UserRoleEnum.Cashier,
            CreatedAt = DateTime.UtcNow.AddDays(-5),
            CreatedBy = _actorId
        });
        await db.SaveChangesAsync();
    }

    private UpdateUserHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_actorId), _audit);

    [Fact]
    public async Task Handle_ValidUpdate_ChangesFieldsAndStampsUpdater()
    {
        await Seed();

        var dto = await Handler().Handle(new UpdateUserCommand(_userId, "New", "Person", "newname", null, UserRoleEnum.Admin), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Username.ShouldBe("newname");
        dto.RoleId.ShouldBe(UserRoleEnum.Admin);
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Users.SingleAsync();
        saved.FirstName.ShouldBe("New");
        saved.LastName.ShouldBe("Person");
        saved.Username.ShouldBe("newname");
        saved.RoleId.ShouldBe((int)UserRoleEnum.Admin);
        saved.UpdatedBy.ShouldBe(_actorId);
        saved.UpdatedAt.ShouldNotBeNull();
        saved.IsActive.ShouldBeTrue();
        saved.CreatedBy.ShouldBe(_actorId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_NoPassword_KeepsExistingHash(string? password)
    {
        await Seed();

        await Handler().Handle(new UpdateUserCommand(_userId, "A", "B", "old", password, UserRoleEnum.Cashier), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).PasswordHash.ShouldBe(_originalHash);
    }

    [Fact]
    public async Task Handle_NewPassword_ReplacesHashWithBCrypt()
    {
        await Seed();

        await Handler().Handle(new UpdateUserCommand(_userId, "A", "B", "old", "fresh-pw", UserRoleEnum.Cashier), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var hash = (await db.Users.SingleAsync()).PasswordHash;
        BCrypt.Net.BCrypt.Verify("fresh-pw", hash).ShouldBeTrue();
        BCrypt.Net.BCrypt.Verify("original-pw", hash).ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_Update_AuditsOldAndNewValuesWithPasswordFlagOnly()
    {
        await Seed();

        await Handler().Handle(new UpdateUserCommand(_userId, "A", "B", "old", "fresh-pw", UserRoleEnum.Admin), CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.UserUpdated, AuditEntityType.User, _userId.ToString(),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("Old") && !o.ToString()!.Contains(_originalHash)),
            Arg.Is<object?>(o => o != null && o.ToString()!.Contains("IsPasswordChanged = True") && !o.ToString()!.Contains("fresh-pw")),
            _actorId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsNullWithoutAudit()
    {
        await Seed();

        var dto = await Handler().Handle(new UpdateUserCommand(Guid.NewGuid(), "A", "B", "x", null, UserRoleEnum.Admin), CancellationToken.None);

        dto.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_BlankUsername_ThrowsAndLeavesUserUnchanged()
    {
        await Seed();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new UpdateUserCommand(_userId, "A", "B", " ", null, UserRoleEnum.Admin), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Users.SingleAsync();
        saved.Username.ShouldBe("old");
        saved.FirstName.ShouldBe("Old");
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    // Real-database version: Database/UserDatabaseTests.cs
}
