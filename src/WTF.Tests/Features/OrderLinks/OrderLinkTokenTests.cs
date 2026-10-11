using WTF.Api.Features.OrderLinks;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.OrderLinks;

public class OrderLinkTokenTests
{
    [Fact]
    public void Generate_Is43UrlSafeCharacters()
    {
        var token = OrderLinkToken.Generate();

        token.Length.ShouldBe(43);
        token.ShouldAllBe(c => char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_');
    }

    [Fact]
    public void Generate_ManyTokens_AreAllDifferent()
    {
        var tokens = Enumerable.Range(0, 500).Select(_ => OrderLinkToken.Generate()).ToList();

        tokens.Distinct().Count().ShouldBe(tokens.Count);
    }

    [Fact]
    public void Generate_FitsTheTokenColumn()
    {
        OrderLinkToken.Generate().Length.ShouldBeLessThanOrEqualTo(64);
    }

    [Theory]
    [InlineData(false, false, "Active")]
    [InlineData(true, false, "Active")]
    [InlineData(false, true, "Revoked")]
    public void Status_ReflectsRevokedAndExpiry(bool futureEnd, bool revoked, string expected)
    {
        var now = DateTime.UtcNow;
        var link = new ShortLink
        {
            ExpiresAt = futureEnd ? now.AddDays(1) : null,
            RevokedAt = revoked ? now.AddMinutes(-1) : null
        };

        OrderLinkStatus.Of(link, now).ShouldBe(expected);
    }

    [Fact]
    public void Status_PastEndDate_IsExpired()
    {
        var now = DateTime.UtcNow;

        OrderLinkStatus.Of(new ShortLink { ExpiresAt = now.AddMinutes(-1) }, now).ShouldBe("Expired");
    }

    [Fact]
    public void Status_RevokedAndExpired_IsRevoked()
    {
        var now = DateTime.UtcNow;
        var link = new ShortLink { ExpiresAt = now.AddDays(-1), RevokedAt = now.AddDays(-2) };

        OrderLinkStatus.Of(link, now).ShouldBe("Revoked");
    }
}
