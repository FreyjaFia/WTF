using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Loyalty;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Loyalty;

public class RedirectToLoyaltyHandlerTests
{
    private readonly string _db = TestDb.NewName();

    private async Task Link(string token, DateTime? expires, Guid target)
    {
        await using var db = TestDb.Create(_db);
        db.ShortLinks.Add(new ShortLink { Id = Guid.NewGuid(), Token = token, TargetType = "Loyalty", TargetId = target, ExpiresAt = expires });
        await db.SaveChangesAsync();
    }

    private async Task<Guid?> Redirect(string token) =>
        (await new RedirectToLoyaltyHandler(TestDb.Create(_db)).Handle(new RedirectToLoyaltyQuery(token), CancellationToken.None)).CustomerId;

    [Fact]
    public async Task Handle_KnownTokenWithoutExpiry_ReturnsCustomer()
    {
        var id = Guid.NewGuid();
        await Link("abc12345", null, id);
        (await Redirect("abc12345")).ShouldBe(id);
    }

    [Fact]
    public async Task Handle_TokenNotExpiredYet_ReturnsCustomer()
    {
        var id = Guid.NewGuid();
        await Link("abc12345", DateTime.UtcNow.AddHours(1), id);
        (await Redirect("abc12345")).ShouldBe(id);
    }

    [Fact]
    public async Task Handle_ExpiredToken_ReturnsNull()
    {
        await Link("abc12345", DateTime.UtcNow.AddMinutes(-1), Guid.NewGuid());
        (await Redirect("abc12345")).ShouldBeNull();
    }

    [Fact]
    public async Task Handle_UnknownToken_ReturnsNull()
    {
        await Link("abc12345", null, Guid.NewGuid());
        (await Redirect("nope")).ShouldBeNull();
    }
}
