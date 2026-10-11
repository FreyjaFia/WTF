using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class LoginHandlerTests
{
    private const string Password = "S3cret-pass";
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly Guid _userId = Guid.NewGuid();

    private static IConfiguration Config()
    {
        var settings = new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
            ["Jwt:Issuer"] = "wtf-tests",
            ["Jwt:Audience"] = "wtf-clients",
            ["Jwt:AccessTokenExpirationMinutes"] = "30",
            ["Jwt:RefreshTokenExpirationDays"] = "3"
        };
        return new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
    }

    private async Task Seed(bool isActive = true, string username = "alem")
    {
        await using var db = TestDb.Create(_dbName);
        db.UserRoles.Add(new UserRole { Id = 1, Name = "Admin" });
        db.Users.Add(new User
        {
            Id = _userId, Username = username, FirstName = "Al", LastName = "Em",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(Password),
            IsActive = isActive, RoleId = 1, CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private LoginHandler Handler(IConfiguration? config = null)
    {
        var cfg = config ?? Config();
        var db = TestDb.Create(_dbName);
        return new LoginHandler(db, new JwtService(cfg, TestRequest.None()), new UserRoleService(db), cfg, _audit);
    }

    [Fact]
    public async Task Handle_ValidCredentials_ReturnsTokensAndStoresRefreshToken()
    {
        await Seed();

        var result = await Handler().Handle(new LoginCommand("alem", Password), CancellationToken.None);

        result.ShouldNotBeNull();
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(result.AccessToken);
        jwt.Subject.ShouldBe(_userId.ToString());
        result.ExpiresAt.ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(28));
        result.ExpiresAt.ShouldBeLessThan(DateTime.UtcNow.AddMinutes(31));

        await using var db = TestDb.Create(_dbName);
        var stored = await db.RefreshTokens.SingleAsync();
        stored.Token.ShouldBe(result.RefreshToken);
        stored.UserId.ShouldBe(_userId);
        stored.IsRevoked.ShouldBeFalse();
        stored.ExpiresAt.ShouldBeGreaterThan(DateTime.UtcNow.AddDays(2.9));
        stored.ExpiresAt.ShouldBeLessThan(DateTime.UtcNow.AddDays(3.1));
    }

    [Fact]
    public async Task Handle_ValidCredentials_WritesLoginAuditWithoutPassword()
    {
        await Seed();

        await Handler().Handle(new LoginCommand("alem", Password), CancellationToken.None);

        await _audit.Received(1).LogAsync(
            AuditAction.UserLogin, AuditEntityType.User, _userId.ToString(),
            Arg.Any<object?>(),
            Arg.Is<object?>(o => o != null && !o.ToString()!.Contains("PasswordHash") && !o.ToString()!.Contains(Password)),
            _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_WrongPassword_ReturnsNullAndIssuesNoToken()
    {
        await Seed();

        var result = await Handler().Handle(new LoginCommand("alem", "wrong"), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_UnknownUser_ReturnsNull()
    {
        await Seed();

        var result = await Handler().Handle(new LoginCommand("nobody", Password), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_InactiveUserWithCorrectPassword_ReturnsNull()
    {
        await Seed(isActive: false);

        var result = await Handler().Handle(new LoginCommand("alem", Password), CancellationToken.None);

        result.ShouldBeNull();
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_EmptyPassword_ReturnsNull()
    {
        await Seed();

        var result = await Handler().Handle(new LoginCommand("alem", ""), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_TwoLogins_IssueDistinctRefreshTokens()
    {
        await Seed();

        var a = await Handler().Handle(new LoginCommand("alem", Password), CancellationToken.None);
        var b = await Handler().Handle(new LoginCommand("alem", Password), CancellationToken.None);

        a.RefreshToken.ShouldNotBe(b.RefreshToken);
        await using var db = TestDb.Create(_dbName);
        (await db.RefreshTokens.CountAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task Handle_NoExpirySettings_DefaultsToSevenDays()
    {
        await Seed();
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256",
            ["Jwt:Issuer"] = "i",
            ["Jwt:Audience"] = "a"
        }).Build();

        await Handler(cfg).Handle(new LoginCommand("alem", Password), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var stored = await db.RefreshTokens.SingleAsync();
        stored.ExpiresAt.ShouldBeGreaterThan(DateTime.UtcNow.AddDays(6.9));
        stored.ExpiresAt.ShouldBeLessThan(DateTime.UtcNow.AddDays(7.1));
    }

    // Real-database version: Database/UserDatabaseTests.cs
}
