using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class RestoreProductHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private RestoreProductHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_InactiveProduct_ReactivatesAndAudits()
    {
        var product = ProductSeed.NewProduct(isActive: false);
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new RestoreProductCommand(product.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Products.SingleAsync();
        saved.IsActive.ShouldBeTrue();
        saved.UpdatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(
            AuditAction.ProductRestored, AuditEntityType.Product, product.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsFalseWithoutAudit()
    {
        var result = await Handler().Handle(new RestoreProductCommand(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
