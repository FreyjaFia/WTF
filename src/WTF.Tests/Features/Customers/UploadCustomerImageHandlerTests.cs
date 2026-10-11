using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class UploadCustomerImageHandlerTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();
    private static readonly byte[] Data = [1, 2, 3];

    public UploadCustomerImageHandlerTests()
    {
        _storage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<CancellationToken>())
            .Returns("/images/customers/new.png");
    }

    private UploadCustomerImageHandler Handler() => new(TestDb.Create(_dbName), _storage, TestRequest.None());

    [Fact]
    public async Task Handle_UnknownCustomer_ReturnsNullAndStoresNothing()
    {
        var result = await Handler().Handle(new UploadCustomerImageCommand(Guid.NewGuid(), Data, "a.png"), CancellationToken.None);

        result.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Theory]
    [InlineData("a.gif")]
    [InlineData("a.svg")]
    [InlineData("noextension")]
    public async Task Handle_DisallowedExtension_ReturnsNull(string fileName)
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new UploadCustomerImageCommand(customer.Id, Data, fileName), CancellationToken.None);

        result.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Handle_EmptyData_ReturnsNull()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new UploadCustomerImageCommand(customer.Id, [], "a.png"), CancellationToken.None);

        result.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_DataOverFiveMegabytes_ReturnsNull()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new UploadCustomerImageCommand(customer.Id, new byte[5 * 1024 * 1024 + 1], "a.png"), CancellationToken.None);

        result.ShouldBeNull();
        await _storage.DidNotReceiveWithAnyArgs().SaveAsync(default!, default!, default!, default);
    }

    [Fact]
    public async Task Handle_ValidImage_SavesFileUnderCustomersAndLinksRows()
    {
        var customer = CustomerSeed.NewCustomer("Mary Ann", "De-La Cruz");
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new UploadCustomerImageCommand(customer.Id, Data, "Me.WEBP"), CancellationToken.None);

        result.ShouldNotBeNull();
        result.ImageUrl.ShouldBe("/images/customers/new.png");
        await _storage.Received(1).SaveAsync(
            "customers",
            Arg.Is<string>(n => n.StartsWith("mary_ann_de_la_cruz_") && n.EndsWith(".webp")),
            Data,
            Arg.Any<CancellationToken>());

        await using var db = TestDb.Create(_dbName);
        var image = await db.Images.SingleAsync();
        var link = await db.CustomerImages.SingleAsync();
        link.CustomerId.ShouldBe(customer.Id);
        link.ImageId.ShouldBe(image.ImageId);
    }

    [Fact]
    public async Task Handle_CustomerAlreadyHasImage_DeletesOldFileAndReplacesRows()
    {
        var customer = CustomerSeed.NewCustomer();
        var oldLink = CustomerSeed.NewImage(customer.Id, "/images/customers/old.png", out var oldImage);
        await CustomerSeed.SeedAsync(_dbName, customer, oldImage, oldLink);

        await Handler().Handle(new UploadCustomerImageCommand(customer.Id, Data, "a.png"), CancellationToken.None);

        await _storage.Received(1).DeleteAsync("/images/customers/old.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.SingleAsync()).ImageUrl.ShouldBe("/images/customers/new.png");
        (await db.CustomerImages.CountAsync()).ShouldBe(1);
    }
}
