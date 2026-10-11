using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Loyalty;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Loyalty;

public class GetLoyaltyPointsHandlerTests
{
    private readonly string _db = TestDb.NewName();

    [Fact]
    public async Task Handle_CustomerWithPoints_ReturnsPointsAndName()
    {
        var customerId = Guid.NewGuid();
        await using (var db = TestDb.Create(_db))
        {
            db.Customers.Add(new Customer
            {
                Id = customerId, FirstName = "Ana", LastName = "Cruz", IsActive = true,
                CreatedAt = DateTime.UtcNow, CreatedBy = Guid.NewGuid()
            });
            db.LoyaltyPoints.Add(new LoyaltyPoint { Id = Guid.NewGuid(), CustomerId = customerId, Points = 42 });
            await db.SaveChangesAsync();
        }

        var dto = await new GetLoyaltyPointsHandler(TestDb.Create(_db))
            .Handle(new GetLoyaltyPointsQuery(customerId), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.CustomerId.ShouldBe(customerId);
        dto.Points.ShouldBe(42);
        dto.FullName.ShouldBe("Ana Cruz");
    }

    [Fact]
    public async Task Handle_CustomerWithoutLoyaltyRow_ReturnsNull()
    {
        var dto = await new GetLoyaltyPointsHandler(TestDb.Create(_db))
            .Handle(new GetLoyaltyPointsQuery(Guid.NewGuid()), CancellationToken.None);
        dto.ShouldBeNull();
    }
}
