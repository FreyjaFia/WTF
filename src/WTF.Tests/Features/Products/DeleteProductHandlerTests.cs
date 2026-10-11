using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class DeleteProductHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private DeleteProductHandler Handler() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    [Fact]
    public async Task Handle_ExistingProduct_SoftDeletesAndAudits()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        var result = await Handler().Handle(new DeleteProductCommand(product.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Products.SingleAsync();
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.ProductDeleted, AuditEntityType.Product, product.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsFalseWithoutAudit()
    {
        var result = await Handler().Handle(new DeleteProductCommand(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
