using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class DeleteItemHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    [Fact]
    public async Task Handle_ExistingItem_SoftDeletesAndAudits()
    {
        var item = await ItemSeed.Item(_db, _userId);
        var ok = await new DeleteItemHandler(TestDb.Create(_db), TestRequest.As(_userId), _audit)
            .Handle(new DeleteItemCommand(item.Id), CancellationToken.None);

        ok.ShouldBeTrue();
        await using var db = TestDb.Create(_db);
        var saved = await db.Items.SingleAsync(); // row is kept
        saved.IsActive.ShouldBeFalse();
        saved.UpdatedBy.ShouldBe(_userId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(AuditAction.ItemDeleted, AuditEntityType.Item, item.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_MissingItem_ReturnsFalseWithoutAudit()
    {
        var ok = await new DeleteItemHandler(TestDb.Create(_db), TestRequest.As(_userId), _audit)
            .Handle(new DeleteItemCommand(Guid.NewGuid()), CancellationToken.None);

        ok.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }
}
