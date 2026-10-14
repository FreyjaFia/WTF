using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using NSubstitute;
using System.IdentityModel.Tokens.Jwt;
using WTF.Api.Services;
using WTF.Domain.Entities;

namespace WTF.Tests.Services;

public class JwtServiceTests
{
    private const string Secret = "unit-test-secret-key-that-is-long-enough-for-hmac-sha256";

    private static JwtService Create(Dictionary<string, string?>? overrides = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = Secret,
            ["Jwt:Issuer"] = "wtf-tests",
            ["Jwt:Audience"] = "wtf-clients",
            ["Jwt:AccessTokenExpirationMinutes"] = "30"
        };
        foreach (var (key, value) in overrides ?? [])
        {
            settings[key] = value;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new JwtService(configuration, Substitute.For<IHttpContextAccessor>());
    }

    private static User SampleUser() => new() { Id = Guid.NewGuid(), Username = "alem" };

    [Theory]
    [InlineData("Jwt:SecretKey")]
    [InlineData("Jwt:Issuer")]
    [InlineData("Jwt:Audience")]
    public void Constructor_MissingRequiredSetting_Throws(string key)
    {
        Should.Throw<InvalidOperationException>(() => Create(new() { [key] = null }));
    }

    [Fact]
    public void GenerateAccessToken_ContainsIdentityAndRoleClaims()
    {
        var user = SampleUser();
        var token = Create().GenerateAccessToken(user, "Cashier");

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        jwt.Issuer.ShouldBe("wtf-tests");
        jwt.Audiences.ShouldContain("wtf-clients");
        jwt.Subject.ShouldBe(user.Id.ToString());
        jwt.Claims.First(c => c.Type == JwtRegisteredClaimNames.UniqueName).Value.ShouldBe("alem");
        jwt.Claims.Count(c => c.Value == "Cashier").ShouldBeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public void GenerateAccessToken_UsesConfiguredExpiration()
    {
        var token = Create().GenerateAccessToken(SampleUser(), "Admin");

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        (jwt.ValidTo - DateTime.UtcNow).TotalMinutes.ShouldBeInRange(29, 31);
    }

    [Fact]
    public void GenerateRefreshToken_Is32RandomBytesAndUnique()
    {
        var service = Create();

        var first = service.GenerateRefreshToken();
        var second = service.GenerateRefreshToken();

        Convert.FromBase64String(first).Length.ShouldBe(32);
        first.ShouldNotBe(second);
    }

    [Fact]
    public void ValidateToken_ValidToken_ReturnsPrincipalWithRole()
    {
        var service = Create();
        var token = service.GenerateAccessToken(SampleUser(), "Admin");

        var principal = service.ValidateToken(token);

        principal.ShouldNotBeNull();
        principal.IsInRole("Admin").ShouldBeTrue();
    }

    [Fact]
    public void ValidateToken_Garbage_ReturnsNull()
    {
        Create().ValidateToken("not.a.token").ShouldBeNull();
    }

    [Fact]
    public void ValidateToken_SignedWithDifferentKey_ReturnsNull()
    {
        var token = Create(new() { ["Jwt:SecretKey"] = "another-secret-key-that-is-also-long-enough-123456" })
            .GenerateAccessToken(SampleUser(), "Admin");

        Create().ValidateToken(token).ShouldBeNull();
    }

    [Fact]
    public void ValidateToken_WrongIssuer_ReturnsNull()
    {
        var token = Create(new() { ["Jwt:Issuer"] = "someone-else" }).GenerateAccessToken(SampleUser(), "Admin");

        Create().ValidateToken(token).ShouldBeNull();
    }

    [Fact]
    public void ValidateToken_Expired_ReturnsNull()
    {
        var token = Create(new() { ["Jwt:AccessTokenExpirationMinutes"] = "-5" })
            .GenerateAccessToken(SampleUser(), "Admin");

        Create().ValidateToken(token).ShouldBeNull();
    }

    [Fact]
    public void GetUserIdFromToken_ValidToken_ReturnsUserId()
    {
        var service = Create();
        var user = SampleUser();

        service.GetUserIdFromToken(service.GenerateAccessToken(user, "Admin")).ShouldBe(user.Id);
    }

    [Fact]
    public void GetUserIdFromToken_InvalidToken_ReturnsNull()
    {
        Create().GetUserIdFromToken("bad").ShouldBeNull();
    }
}
