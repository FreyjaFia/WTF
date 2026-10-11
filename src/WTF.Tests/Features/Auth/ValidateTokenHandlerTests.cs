using Microsoft.Extensions.Configuration;
using WTF.Api.Features.Auth;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Auth;

public class ValidateTokenHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private static JwtService Jwt(string secret = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256", string minutes = "30")
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = secret,
            ["Jwt:Issuer"] = "wtf-tests",
            ["Jwt:Audience"] = "wtf-clients",
            ["Jwt:AccessTokenExpirationMinutes"] = minutes
        }).Build();
        return new JwtService(cfg, TestRequest.None());
    }

    private User SeedUser(bool active = true) => new()
    {
        Id = _userId, Username = "alem", FirstName = "Al", LastName = "Em",
        PasswordHash = "h", IsActive = active, RoleId = 1, CreatedAt = DateTime.UtcNow
    };

    private async Task Seed(bool active = true)
    {
        await using var db = TestDb.Create(_dbName);
        db.Users.Add(SeedUser(active));
        await db.SaveChangesAsync();
    }

    private ValidateTokenHandler Handler() => new(TestDb.Create(_dbName), Jwt());

    [Fact]
    public async Task Handle_ValidTokenForExistingUser_IsValid()
    {
        await Seed();
        var token = Jwt().GenerateAccessToken(SeedUser(), "Admin");

        var result = await Handler().Handle(new ValidateTokenQuery(token), CancellationToken.None);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public async Task Handle_GarbageToken_IsInvalid()
    {
        await Seed();

        var result = await Handler().Handle(new ValidateTokenQuery("not-a-jwt"), CancellationToken.None);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_TokenSignedWithOtherKey_IsInvalid()
    {
        await Seed();
        var token = Jwt("another-secret-key-that-is-also-long-enough-for-hmac").GenerateAccessToken(SeedUser(), "Admin");

        var result = await Handler().Handle(new ValidateTokenQuery(token), CancellationToken.None);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ExpiredToken_IsInvalid()
    {
        await Seed();
        var token = Jwt(minutes: "-5").GenerateAccessToken(SeedUser(), "Admin");

        var result = await Handler().Handle(new ValidateTokenQuery(token), CancellationToken.None);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_UserNoLongerExists_IsInvalid()
    {
        var token = Jwt().GenerateAccessToken(SeedUser(), "Admin");

        var result = await Handler().Handle(new ValidateTokenQuery(token), CancellationToken.None);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_InactiveUser_IsInvalid()
    {
        await Seed(active: false);
        var token = Jwt().GenerateAccessToken(SeedUser(false), "Admin");

        var result = await Handler().Handle(new ValidateTokenQuery(token), CancellationToken.None);

        result.IsValid.ShouldBeFalse();
    }
}
