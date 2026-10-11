using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

/// <summary>Also proves the in-memory database setup end to end with a small real handler.</summary>
public class CreateCustomerHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = Substitute.For<IAuditService>();

    private CreateCustomerHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_ValidCustomer_IsSavedAndAudited()
    {
        var dto = await Handler().Handle(new CreateCustomerCommand("Ana", "Cruz", "Manila"), CancellationToken.None);

        dto.FirstName.ShouldBe("Ana");
        dto.IsActive.ShouldBeTrue();

        // Read back through a different context, as a later request would.
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Customers.SingleAsync();
        saved.LastName.ShouldBe("Cruz");
        saved.CreatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(
            AuditAction.CustomerCreated,
            AuditEntityType.Customer,
            saved.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _userId,
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("", "Cruz")]
    [InlineData("Ana", " ")]
    public async Task Handle_MissingName_ThrowsAndSavesNothing(string first, string last)
    {
        await Should.ThrowAsync<InvalidOperationException>(() =>
            Handler().Handle(new CreateCustomerCommand(first, last, null), CancellationToken.None));

        await using var db = TestDb.Create(_dbName);
        (await db.Customers.CountAsync()).ShouldBe(0);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
