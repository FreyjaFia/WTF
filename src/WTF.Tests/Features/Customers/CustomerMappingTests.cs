using WTF.Api.Features.Customers;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Customers;

public class CustomerMappingTests
{
    [Fact]
    public void ToDto_CopiesFieldsAndImageUrl()
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Ana",
            LastName = "Cruz",
            Address = "Manila",
            IsActive = true,
            CreatedAt = new DateTime(2025, 1, 1),
            CreatedBy = Guid.NewGuid(),
            UpdatedAt = new DateTime(2025, 2, 1),
            UpdatedBy = Guid.NewGuid()
        };

        var dto = CustomerMapping.ToDto(customer, "https://img/a.png");

        dto.Id.ShouldBe(customer.Id);
        dto.FirstName.ShouldBe("Ana");
        dto.LastName.ShouldBe("Cruz");
        dto.Address.ShouldBe("Manila");
        dto.IsActive.ShouldBeTrue();
        dto.CreatedBy.ShouldBe(customer.CreatedBy);
        dto.UpdatedAt.ShouldBe(customer.UpdatedAt);
        dto.UpdatedBy.ShouldBe(customer.UpdatedBy);
        dto.ImageUrl.ShouldBe("https://img/a.png");
    }

    [Fact]
    public void ToDto_NullImage_StaysNull()
    {
        var dto = CustomerMapping.ToDto(new Customer { FirstName = "A", LastName = "B" }, null);

        dto.ImageUrl.ShouldBeNull();
    }
}
