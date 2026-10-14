using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class RefreshTokenHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private RefreshTokenHandler Handler()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
            ["Jwt:Issuer"] = "wtf-tests",
            ["Jwt:Audience"] = "wtf-clients",
            ["Jwt:RefreshTokenExpirationDays"] = "5"
        }).Build();
        var db = TestDb.Create(_dbName);
        return new RefreshTokenHandler(db, new JwtService(cfg, TestRequest.None()), new UserRoleService(db), cfg);
    }

    private async Task Seed(string token, bool userActive = true, bool revoked = false, int expiresInDays = 1)
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
        db.Users.Add(new User
        {
            Id = _userId,
            Username = "alem",
            FirstName = "Al",
            LastName = "Em",
            PasswordHash = "x",
            IsActive = userActive,
            RoleId = 1,
            CreatedAt = DateTime.UtcNow
        });
        db.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = _userId,
            Token = token,
            IsRevoked = revoked,
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(expiresInDays)
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Handle_ValidToken_RotatesTokenAndRevokesOld()
    {
        await Seed("old");

        var result = await Handler().Handle(new RefreshTokenCommand("old"), CancellationToken.None);

        result.ShouldNotBeNull();
        result.RefreshToken.ShouldNotBe("old");
        result.AccessToken.ShouldNotBeNullOrWhiteSpace();
        await using var db = TestDb.Create(_dbName);
        var tokens = await db.RefreshTokens.ToListAsync();
        tokens.Count.ShouldBe(2);
        tokens.Single(t => t.Token == "old").IsRevoked.ShouldBeTrue();
        var fresh = tokens.Single(t => t.Token == result.RefreshToken);
        fresh.IsRevoked.ShouldBeFalse();
        fresh.UserId.ShouldBe(_userId);
        fresh.ExpiresAt.ShouldBeGreaterThan(DateTime.UtcNow.AddDays(4.9));
    }

    [Fact]
    public async Task Handle_TokenUsedTwice_SecondUseIsRejected()
    {
        await Seed("old");

        var first = await Handler().Handle(new RefreshTokenCommand("old"), CancellationToken.None);
        var second = await Handler().Handle(new RefreshTokenCommand("old"), CancellationToken.None);

        first.ShouldNotBeNull();
        second.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task Handle_UnknownToken_ReturnsNull()
    {
        await Seed("old");

        var result = await Handler().Handle(new RefreshTokenCommand("nope"), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_RevokedToken_ReturnsNullAndCreatesNothing()
    {
        await Seed("old", revoked: true);

        var result = await Handler().Handle(new RefreshTokenCommand("old"), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_ExpiredToken_ReturnsNull()
    {
        await Seed("old", expiresInDays: -1);

        var result = await Handler().Handle(new RefreshTokenCommand("old"), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_InactiveUser_ReturnsNullAndLeavesTokenUnchanged()
    {
        await Seed("old", userActive: false);

        var result = await Handler().Handle(new RefreshTokenCommand("old"), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.SingleAsync()).IsRevoked.ShouldBeFalse();
    }
}
