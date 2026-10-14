using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Loyalty;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Loyalty;

public class GenerateShortLinkHandlerTests
{
    private readonly string _db = TestDb.NewName();

    [Fact]
    public async Task Handle_Customer_CreatesLoyaltyLinkWithEightCharToken()
    {
        var customerId = Guid.NewGuid();
        var dto = await new GenerateShortLinkHandler(TestDb.Create(_db))
            .Handle(new GenerateShortLinkCommand(customerId), CancellationToken.None);

        dto.Token.Length.ShouldBe(8);
        dto.Token.ShouldAllBe(c => char.IsAsciiLetterOrDigit(c));
        await using var db = TestDb.Create(_db);
        var link = await db.ShortLinks.SingleAsync();
        link.Token.ShouldBe(dto.Token);
        link.TargetType.ShouldBe("Loyalty");
        link.TargetId.ShouldBe(customerId);
        link.ExpiresAt.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_CalledTwice_CreatesTwoLinksWithDifferentTokens()
    {
        var customerId = Guid.NewGuid();
        var a = await new GenerateShortLinkHandler(TestDb.Create(_db)).Handle(new GenerateShortLinkCommand(customerId), CancellationToken.None);
        var b = await new GenerateShortLinkHandler(TestDb.Create(_db)).Handle(new GenerateShortLinkCommand(customerId), CancellationToken.None);

        a.Token.ShouldNotBe(b.Token);
        await using var db = TestDb.Create(_db);
        (await db.ShortLinks.CountAsync()).ShouldBe(2);
    }
}
