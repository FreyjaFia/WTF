using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class ChangePasswordHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task Seed()
    {
        await using var db = TestDb.Create(_dbName);
        db.Users.Add(new User
        {
            Id = _userId, Username = "alem", FirstName = "Al", LastName = "Em",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("old-password"),
            IsActive = true, RoleId = 1, CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private ChangePasswordHandler Handler(Guid? asUser = null) =>
        new(TestDb.Create(_dbName), TestRequest.As(asUser ?? _userId, AppRoles.Admin), _audit);

    [Fact]
    public async Task Handle_CorrectCurrentPassword_StoresNewHashAndAudits()
    {
        await Seed();

        var ok = await Handler().Handle(new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = "new-password-1" }, CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var hash = (await db.Users.SingleAsync()).PasswordHash;
        hash.ShouldNotBe("new-password-1");
        BCrypt.Net.BCrypt.Verify("new-password-1", hash).ShouldBeTrue();
        BCrypt.Net.BCrypt.Verify("old-password", hash).ShouldBeFalse();
        await _audit.Received(1).LogAsync(
            AuditAction.UserPasswordChanged, AuditEntityType.User, _userId.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_WrongCurrentPassword_ReturnsFalseAndKeepsHash()
    {
        await Seed();
        string before;
        await using (var db = TestDb.Create(_dbName)) before = (await db.Users.SingleAsync()).PasswordHash;

        var ok = await Handler().Handle(new ChangePasswordCommand { CurrentPassword = "guess", NewPassword = "new-password-1" }, CancellationToken.None);

        ok.ShouldBeFalse();
        await using var db2 = TestDb.Create(_dbName);
        (await db2.Users.SingleAsync()).PasswordHash.ShouldBe(before);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_UnknownSignedInUser_ReturnsFalse()
    {
        await Seed();

        var ok = await Handler(Guid.NewGuid()).Handle(new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = "new-password-1" }, CancellationToken.None);

        ok.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_OnlyChangesSignedInUser()
    {
        await Seed();
        var otherId = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.Users.Add(new User { Id = otherId, Username = "b", FirstName = "B", LastName = "B", PasswordHash = "other-hash", IsActive = true, RoleId = 1, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        await Handler().Handle(new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = "new-password-1" }, CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        (await check.Users.SingleAsync(u => u.Id == otherId)).PasswordHash.ShouldBe("other-hash");
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("1234567")]
    public async Task Handle_NewPasswordTooShort_IsRejectedAndNothingChanges(string newPassword)
    {
        await Seed();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = newPassword }, CancellationToken.None));

        ex.Message.ShouldContain("at least 8");
        await using var check = TestDb.Create(_dbName);
        BCrypt.Net.BCrypt.Verify("old-password", (await check.Users.SingleAsync()).PasswordHash).ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_NewPasswordOfExactlyEightCharacters_IsAccepted()
    {
        await Seed();

        var ok = await Handler().Handle(
            new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = "12345678" }, CancellationToken.None);

        ok.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_Success_OnlyRevokesTheSignedInUsersTokens()
    {
        await Seed();
        var otherUser = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = otherUser, Token = "theirs", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
            db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = _userId, Token = "mine", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }

        await Handler().Handle(new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = "new-password-1" }, CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        (await check.RefreshTokens.SingleAsync(t => t.Token == "mine")).IsRevoked.ShouldBeTrue();
        (await check.RefreshTokens.SingleAsync(t => t.Token == "theirs")).IsRevoked.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_WrongCurrentPassword_DoesNotRevokeAnyTokens()
    {
        await Seed();
        await using (var db = TestDb.Create(_dbName))
        {
            db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = _userId, Token = "mine", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }

        var ok = await Handler().Handle(new ChangePasswordCommand { CurrentPassword = "wrong", NewPassword = "new-password-1" }, CancellationToken.None);

        ok.ShouldBeFalse();
        await using var check = TestDb.Create(_dbName);
        (await check.RefreshTokens.SingleAsync()).IsRevoked.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_Success_RevokesRefreshTokens()
    {
        await Seed();
        await using (var db = TestDb.Create(_dbName))
        {
            db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = _userId, Token = "t", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }

        await Handler().Handle(new ChangePasswordCommand { CurrentPassword = "old-password", NewPassword = "new-password-1" }, CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        (await check.RefreshTokens.SingleAsync()).IsRevoked.ShouldBeTrue();
    }
}
