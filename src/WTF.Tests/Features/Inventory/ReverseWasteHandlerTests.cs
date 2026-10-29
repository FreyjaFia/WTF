using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class ReverseWasteHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _adminId = Guid.NewGuid();
    private readonly Guid _cashierId;
    private readonly int _reasonId;
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IStockAlertService _alerts = Substitute.For<IStockAlertService>();

    public ReverseWasteHandlerTests()
    {
        WasteSeed.User(_db, AppRoles.Admin, _adminId, first: "Ada", last: "Admin");
        _cashierId = WasteSeed.User(_db, AppRoles.Cashier);
        _reasonId = WasteSeed.Reason(_db);
    }

    [Theory]
    [InlineData(StockWasteStatuses.Recorded)]
    [InlineData(StockWasteStatuses.PendingReview)]
    [InlineData(StockWasteStatuses.Confirmed)]
    [InlineData(StockWasteStatuses.Disputed)]
    public async Task Handle_PutsQuantityBackWithWasteReversedMovement(byte status)
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 400m, cost: 0.2m);
        var wasteId = WasteSeed.Entry(_db, itemId, _reasonId, _cashierId, quantity: 150m, status: status);

        var result = await Handler().Handle(new ReverseWasteCommand(wasteId, "  entered twice  "), default);

        result.ShouldNotBeNull();
        result.Status.ShouldBe("Reversed");
        result.ReversalReason.ShouldBe("entered twice");
        result.ReversedAt.ShouldNotBeNull();
        result.ReversedByName.ShouldNotBeNull();
        result.ReversedByName.ShouldContain("Ada");
        StockSeed.Balance(_db, itemId).ShouldBe(550m);

        var reversal = StockSeed.Movements(_db, itemId).Single(m => m.MovementType == StockMovementTypes.WasteReversed);
        reversal.QuantityDelta.ShouldBe(150m);
        reversal.QuantityBefore.ShouldBe(400m);
        reversal.QuantityAfter.ShouldBe(550m);
        reversal.Notes.ShouldBe("Waste reversed: entered twice");
        reversal.CreatedBy.ShouldBe(_adminId);

        await using var db = TestDb.Create(_db);
        var waste = await db.StockWastes.SingleAsync();
        waste.Status.ShouldBe(StockWasteStatuses.Reversed);
        waste.ReversedBy.ShouldBe(_adminId);
        waste.ReversalMovementId.ShouldBe(reversal.Id);
        await _alerts.Received(1).EvaluateAsync(
            Arg.Is<IEnumerable<Guid>>(ids => ids.Contains(itemId)),
            Arg.Any<CancellationToken>());
        await _audit.Received(1).LogAsync(
            AuditAction.StockWasteReversed,
            AuditEntityType.StockWaste,
            wasteId.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_SecondReverse_ThrowsAndWritesNothingMore()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 400m);
        var wasteId = WasteSeed.Entry(_db, itemId, _reasonId, _cashierId, quantity: 100m);
        await Handler().Handle(new ReverseWasteCommand(wasteId, "mistake"), default);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(new ReverseWasteCommand(wasteId, "again"), default));

        ex.Message.ShouldBe("This waste entry was already reversed.");
        StockSeed.Balance(_db, itemId).ShouldBe(500m);
        StockSeed.Movements(_db, itemId).Count(m => m.MovementType == StockMovementTypes.WasteReversed).ShouldBe(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task Handle_WithoutReason_Throws(string? reason)
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 400m);
        var wasteId = WasteSeed.Entry(_db, itemId, _reasonId, _cashierId);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(new ReverseWasteCommand(wasteId, reason), default));

        ex.Message.ShouldBe("Say why the waste entry is reversed.");
        StockSeed.Balance(_db, itemId).ShouldBe(400m);
    }

    [Fact]
    public async Task Handle_ReasonTooLong_Throws()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 400m);
        var wasteId = WasteSeed.Entry(_db, itemId, _reasonId, _cashierId);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(new ReverseWasteCommand(wasteId, new string('x', 501)), default));

        ex.Message.ShouldBe("The reason can be at most 500 characters.");
    }

    [Fact]
    public async Task Handle_UnknownEntry_ReturnsNull()
    {
        var result = await Handler().Handle(new ReverseWasteCommand(Guid.NewGuid(), "mistake"), default);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Handle_InactiveItem_Throws()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 400m, active: false);
        var wasteId = WasteSeed.Entry(_db, itemId, _reasonId, _cashierId);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(new ReverseWasteCommand(wasteId, "mistake"), default));

        ex.Message.ShouldBe("This item is inactive. Restore it before reversing its waste.");
        StockSeed.Balance(_db, itemId).ShouldBe(400m);
    }

    [Fact]
    public async Task Handle_BlockingItemBelowZero_StillPutsQuantityBack()
    {
        var itemId = StockSeed.Item(_db, "Cup", -5m, allowNegative: false);
        var wasteId = WasteSeed.Entry(_db, itemId, _reasonId, _cashierId, quantity: 3m);

        var result = await Handler().Handle(new ReverseWasteCommand(wasteId, "mistake"), default);

        result.ShouldNotBeNull();
        StockSeed.Balance(_db, itemId).ShouldBe(-2m);
    }

    private ReverseWasteHandler Handler() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit, _alerts);
}
