using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class RemoveCustomerImageHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();

    private RemoveCustomerImageHandler Handler() => new(TestDb.Create(_dbName), _storage);

    [Fact]
    public async Task Handle_UnknownCustomer_ReturnsNull()
    {
        var result = await Handler().Handle(new RemoveCustomerImageCommand(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_CustomerWithImage_DeletesFileAndRows()
    {
        var customer = CustomerSeed.NewCustomer();
        var link = CustomerSeed.NewImage(customer.Id, "/images/customers/old.png", out var image);
        await CustomerSeed.SeedAsync(_dbName, customer, image, link);

        var result = await Handler().Handle(new RemoveCustomerImageCommand(customer.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.ImageUrl.ShouldBeNull();
        await _storage.Received(1).DeleteAsync("/images/customers/old.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(0);
        (await db.CustomerImages.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_CustomerWithoutImage_ReturnsCustomerWithoutTouchingStorage()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new RemoveCustomerImageCommand(customer.Id), CancellationToken.None);

        result.ShouldNotBeNull();
        result.Id.ShouldBe(customer.Id);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }
}
