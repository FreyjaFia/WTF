using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class UpdateMeHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _userId = Guid.NewGuid();

    private const string OldPassword = "old-pass-1";
    private static readonly string OldHash = BCrypt.Net.BCrypt.HashPassword(OldPassword);

    private async Task Seed()
    {
        await using var db = TestDb.Create(_dbName);
        db.Users.Add(new User
        {
            Id = _userId,
            Username = "alem",
            FirstName = "Al",
            LastName = "Em",
            PasswordHash = OldHash,
            IsActive = true,
            RoleId = 1,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private UpdateMeHandler Handler(Guid? asUser = null) =>
        new(TestDb.Create(_dbName), TestRequest.As(asUser ?? _userId, AppRoles.Admin), _audit);

    [Fact]
    public async Task Handle_NewPassword_HashesItAndAudits()
    {
        await Seed();

        var ok = await Handler().Handle(new UpdateMeCommand("brand-new", OldPassword), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var hash = (await db.Users.SingleAsync()).PasswordHash;
        hash.ShouldNotBe("brand-new");
        BCrypt.Net.BCrypt.Verify("brand-new", hash).ShouldBeTrue();
        await _audit.Received(1).LogAsync(
            AuditAction.UserPasswordChanged, AuditEntityType.User, _userId.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("short")]
    [InlineData("1234567")]
    public async Task Handle_PasswordShorterThanEightCharacters_IsRejectedAndKeepsHash(string password)
    {
        await Seed();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new UpdateMeCommand(password, OldPassword), CancellationToken.None));

        ex.Message.ShouldBe("New password must be at least 8 characters.");
        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).PasswordHash.ShouldBe(OldHash);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_ExactlyEightCharacters_IsAccepted()
    {
        await Seed();

        var ok = await Handler().Handle(new UpdateMeCommand("12345678", OldPassword), CancellationToken.None);

        ok.ShouldBeTrue();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wrong-password")]
    public async Task Handle_MissingOrWrongCurrentPassword_IsRejectedAndKeepsHash(string? current)
    {
        await Seed();

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new UpdateMeCommand("brand-new", current), CancellationToken.None));

        ex.Message.ShouldBe("Current password is incorrect.");
        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).PasswordHash.ShouldBe(OldHash);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsFalse()
    {
        await Seed();

        var ok = await Handler(Guid.NewGuid()).Handle(new UpdateMeCommand("brand-new", OldPassword), CancellationToken.None);

        ok.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        (await db.Users.SingleAsync()).PasswordHash.ShouldBe(OldHash);
    }

    [Fact]
    public async Task Handle_NewPassword_RevokesTheUsersRefreshTokensButNotOthers()
    {
        await Seed();
        var otherUser = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = _userId, Token = "mine", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
            db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = otherUser, Token = "theirs", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        }

        await Handler().Handle(new UpdateMeCommand("brand-new", OldPassword), CancellationToken.None);

        await using var check = TestDb.Create(_dbName);
        (await check.RefreshTokens.SingleAsync(t => t.Token == "mine")).IsRevoked.ShouldBeTrue();
        (await check.RefreshTokens.SingleAsync(t => t.Token == "theirs")).IsRevoked.ShouldBeFalse();
    }
}
