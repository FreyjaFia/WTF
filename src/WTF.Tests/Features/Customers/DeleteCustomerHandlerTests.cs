using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class DeleteCustomerHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private DeleteCustomerHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_ExistingCustomer_SoftDeletesKeepingRowAndAudits()
    {
        var customer = CustomerSeed.NewCustomer();
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new DeleteCustomerCommand(customer.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.Customers.SingleAsync()).IsActive.ShouldBeFalse();
        await _audit.Received(1).LogAsync(
            AuditAction.CustomerDeleted, AuditEntityType.Customer, customer.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownCustomer_ReturnsFalseWithoutAudit()
    {
        var result = await Handler().Handle(new DeleteCustomerCommand(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
