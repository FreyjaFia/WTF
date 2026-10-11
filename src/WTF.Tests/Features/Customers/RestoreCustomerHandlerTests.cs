using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

public class RestoreCustomerHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private RestoreCustomerHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_InactiveCustomer_ReactivatesAndAudits()
    {
        var customer = CustomerSeed.NewCustomer(isActive: false);
        await CustomerSeed.SeedAsync(_dbName, customer);

        var result = await Handler().Handle(new RestoreCustomerCommand(customer.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.Customers.SingleAsync()).IsActive.ShouldBeTrue();
        await _audit.Received(1).LogAsync(
            AuditAction.CustomerRestored, AuditEntityType.Customer, customer.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownCustomer_ReturnsFalseWithoutAudit()
    {
        var result = await Handler().Handle(new RestoreCustomerCommand(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
