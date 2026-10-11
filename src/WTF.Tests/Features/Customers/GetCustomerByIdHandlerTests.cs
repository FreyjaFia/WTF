using WTF.Api.Features.Customers;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class GetCustomerByIdHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private GetCustomerByIdHandler Handler() => new(TestDb.Create(_dbName), TestRequest.None());

    [Fact]
    public async Task Handle_UnknownCustomer_ReturnsNull()
    {
        var result = await Handler().Handle(new GetCustomerByIdQuery(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_InactiveCustomer_IsStillReturned()
    {
        var customer = CustomerSeed.NewCustomer(isActive: false);
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new GetCustomerByIdQuery(customer.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_CustomerWithImage_ReturnsImageUrl()
    {
        var customer = CustomerSeed.NewCustomer();
        var link = CustomerSeed.NewImage(customer.Id, "https://cdn.example/c.png", out var image);
        await CustomerSeed.SeedAsync(_dbName, customer, image, link);

        var result = await Handler().Handle(new GetCustomerByIdQuery(customer.Id), CancellationToken.None);

        result!.ImageUrl.ShouldBe("https://cdn.example/c.png");
    }

    [Fact]
    public async Task Handle_CustomerWithoutImage_ReturnsNullImageUrl()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new GetCustomerByIdQuery(customer.Id), CancellationToken.None);

        result!.ImageUrl.ShouldBeNull();
        result.FirstName.ShouldBe("Ana");
    }
}
