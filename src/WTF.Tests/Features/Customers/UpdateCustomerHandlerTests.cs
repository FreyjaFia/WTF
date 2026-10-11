using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class UpdateCustomerHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private UpdateCustomerHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_UnknownCustomer_ReturnsNullWithoutAudit()
    {
        var result = await Handler().Handle(new UpdateCustomerCommand(Guid.NewGuid(), "A", "B", null), CancellationToken.None);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_ValidUpdate_SavesFieldsStampsUserAndAudits()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var dto = await Handler().Handle(new UpdateCustomerCommand(customer.Id, "Bea", "Reyes", "Cebu"), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.FirstName.ShouldBe("Bea");
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Customers.SingleAsync();
        saved.FirstName.ShouldBe("Bea");
        saved.LastName.ShouldBe("Reyes");
        saved.Address.ShouldBe("Cebu");
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.CustomerUpdated, AuditEntityType.Customer, customer.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_ContactNumber_IsSavedChangedAndCleared()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var dto = await Handler().Handle(
            new UpdateCustomerCommand(customer.Id, "Ana", "Cruz", null, "0917 123 4567"), CancellationToken.None);
        dto!.ContactNumber.ShouldBe("0917 123 4567");

        await Handler().Handle(new UpdateCustomerCommand(customer.Id, "Ana", "Cruz", null, null), CancellationToken.None);
        await using var db = TestDb.Create(_dbName);
        (await db.Customers.SingleAsync()).ContactNumber.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_InvalidContactNumber_ThrowsAndKeepsTheOldOne()
    {
        var customer = CustomerSeed.NewCustomer();
        customer.ContactNumber = "0917 123 4567";
        await CustomerSeed.SeedAsync(_dbName, customer);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new UpdateCustomerCommand(customer.Id, "Ana", "Cruz", null, "abc"), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Customers.SingleAsync()).ContactNumber.ShouldBe("0917 123 4567");
    }

    [Fact]
    public async Task Handle_NullAddress_ClearsAddress()
    {
        var customer = CustomerSeed.NewCustomer(address: "Manila");
        await CustomerSeed.SeedAsync(_dbName, customer);

        await Handler().Handle(new UpdateCustomerCommand(customer.Id, "Ana", "Cruz", null), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.Customers.SingleAsync()).Address.ShouldBeNull();
    }

    [Theory]
    [InlineData("", "Cruz")]
    [InlineData("Ana", "  ")]
    public async Task Handle_MissingName_ThrowsAndPersistsNothing(string first, string last)
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new UpdateCustomerCommand(customer.Id, first, last, "Elsewhere"), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        var saved = await db.Customers.SingleAsync();
        saved.FirstName.ShouldBe("Ana");
        saved.Address.ShouldBe("Manila");
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_CustomerWithImage_ResponseKeepsImageUrl()
    {
        var customer = CustomerSeed.NewCustomer();
        var link = CustomerSeed.NewImage(customer.Id, "https://cdn.example/c.png", out var image);
        await CustomerSeed.SeedAsync(_dbName, customer, image, link);

        var dto = await Handler().Handle(new UpdateCustomerCommand(customer.Id, "Ana", "Cruz", null), CancellationToken.None);

        dto!.ImageUrl.ShouldBe("https://cdn.example/c.png");
    }
}
