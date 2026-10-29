using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Notifications;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class RecordWasteHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly INotificationService _notifications = Substitute.For<INotificationService>();
    private readonly IStockAlertService _alerts = Substitute.For<IStockAlertService>();

    public RecordWasteHandlerTests()
    {
        WasteSeed.User(_db, AppRoles.Cashier, _userId, first: "Cara", last: "Cashier");
    }

    [Fact]
    public async Task Handle_BelowLimit_WritesWasteMovementAndRecordedEntry()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m, cost: 0.15m);
        var reasonId = WasteSeed.Reason(_db, "Spilled or dropped");

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 250m, reasonId, "  knocked over  ", null), default);

        result.ShouldNotBeNull();
        result.Status.ShouldBe("Recorded");
        result.RequiresReview.ShouldBeFalse();
        result.Quantity.ShouldBe(250m);
        result.QuantityBefore.ShouldBe(1000m);
        result.QuantityAfter.ShouldBe(750m);
        result.Notes.ShouldBe("knocked over");
        result.Source.ShouldBe((int)StockWasteStatuses.SourceItemDetails);
        StockSeed.Balance(_db, itemId).ShouldBe(750m);

        var movement = StockSeed.Movements(_db, itemId).Single();
        movement.MovementType.ShouldBe(StockMovementTypes.Waste);
        movement.QuantityDelta.ShouldBe(-250m);
        movement.UnitCost.ShouldBe(0.15m);
        movement.ReferenceType.ShouldBe(StockMovementTypes.StockWasteReference);
        movement.ReferenceId.ShouldBe(result.Id);
        movement.Notes.ShouldBe("Spilled or dropped: knocked over");
        movement.CreatedBy.ShouldBe(_userId);

        await using var db = TestDb.Create(_db);
        var waste = await db.StockWastes.SingleAsync();
        waste.StockMovementId.ShouldBe(movement.Id);
        waste.ReasonName.ShouldBe("Spilled or dropped");
        waste.Status.ShouldBe(StockWasteStatuses.Recorded);
        await _alerts.Received(1).EvaluateAsync(
            Arg.Is<IEnumerable<Guid>>(ids => ids.Contains(itemId)),
            Arg.Any<CancellationToken>());
        await _audit.Received(1).LogAsync(
            AuditAction.StockWasted,
            AuditEntityType.StockWaste,
            result.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _userId,
            Arg.Any<CancellationToken>());
        await _notifications.DidNotReceiveWithAnyArgs().NotifyAsync(default!, default!, default);
    }

    [Fact]
    public async Task Handle_WithoutNote_UsesReasonNameAsMovementNote()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db, "Expired or spoiled");

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 100m, reasonId, "   ", (byte)2), default);

        result!.Notes.ShouldBeNull();
        result.Source.ShouldBe((int)StockWasteStatuses.SourcePos);
        StockSeed.Movements(_db, itemId).Single().Notes.ShouldBe("Expired or spoiled");
    }

    [Fact]
    public async Task Handle_WarnOnlyItem_MayGoBelowZero()
    {
        var itemId = StockSeed.Item(_db, "Syrup", 50m, allowNegative: true);
        var reasonId = WasteSeed.Reason(_db);

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 80m, reasonId, null, null), default);

        result!.QuantityAfter.ShouldBe(-30m);
        StockSeed.Balance(_db, itemId).ShouldBe(-30m);
    }

    [Fact]
    public async Task Handle_BlockingItemShortfall_ThrowsAndSavesNothing()
    {
        var itemId = StockSeed.Item(_db, "Cup", 2m, allowNegative: false);
        var reasonId = WasteSeed.Reason(_db);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 5m, reasonId, null, null), default));

        ex.Message.ShouldStartWith("Not enough Cup: short by 3");
        ex.Message.ShouldContain("cannot go below zero");
        StockSeed.Balance(_db, itemId).ShouldBe(2m);
        StockSeed.Movements(_db, itemId).ShouldBeEmpty();
        await using var db = TestDb.Create(_db);
        (await db.StockWastes.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Handle_BlockingItemWithEnoughStock_GoesToZero()
    {
        var itemId = StockSeed.Item(_db, "Cup", 5m, allowNegative: false);
        var reasonId = WasteSeed.Reason(_db);

        await Handler().Handle(new RecordWasteCommand(itemId, 5m, reasonId, null, null), default);

        StockSeed.Balance(_db, itemId).ShouldBe(0m);
    }

    [Fact]
    public async Task Handle_InactiveItem_Throws()
    {
        var itemId = StockSeed.Item(_db, "Old Syrup", 100m, active: false);
        var reasonId = WasteSeed.Reason(_db);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 10m, reasonId, null, null), default));

        ex.Message.ShouldBe("This item is inactive. Restore it before recording waste.");
        StockSeed.Balance(_db, itemId).ShouldBe(100m);
    }

    [Fact]
    public async Task Handle_UnknownItem_ReturnsNull()
    {
        var reasonId = WasteSeed.Reason(_db);

        var result = await Handler().Handle(new RecordWasteCommand(Guid.NewGuid(), 10m, reasonId, null, null), default);

        result.ShouldBeNull();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(1000000)]
    [InlineData(0.0001)]
    public async Task Handle_QuantityOutOfRange_Throws(double quantity)
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, (decimal)quantity, reasonId, null, null), default));

        ex.Message.ShouldBe("Enter a quantity above zero and at most 999,999.999.");
    }

    [Fact]
    public async Task Handle_UnknownSource_Throws()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 10m, reasonId, null, (byte)9), default));

        ex.Message.ShouldBe("Unknown waste source.");
    }

    [Fact]
    public async Task Handle_NoteTooLong_Throws()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 10m, reasonId, new string('a', 501), null), default));

        ex.Message.ShouldBe("The note can be at most 500 characters.");
    }

    [Fact]
    public async Task Handle_InactiveOrMissingReason_Throws()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var inactiveId = WasteSeed.Reason(_db, "Retired", active: false);

        var inactive = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 10m, inactiveId, null, null), default));
        var missing = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 10m, 99999, null, null), default));

        inactive.Message.ShouldBe("Choose one of the listed waste reasons.");
        missing.Message.ShouldBe("Choose one of the listed waste reasons.");
        StockSeed.Balance(_db, itemId).ShouldBe(1000m);
    }

    [Fact]
    public async Task Handle_ReasonRequiresNote_WithoutNote_Throws()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db, "Other", requiresNote: true, system: true);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Handler().Handle(new RecordWasteCommand(itemId, 10m, reasonId, "  ", null), default));

        ex.Message.ShouldBe("A note is required when the reason is Other.");
        StockSeed.Movements(_db, itemId).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_ReasonRequiresNote_WithNote_Succeeds()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 1000m);
        var reasonId = WasteSeed.Reason(_db, "Other", requiresNote: true, system: true);

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 10m, reasonId, "Fed the cat", null), default);

        result!.Notes.ShouldBe("Fed the cat");
    }

    [Fact]
    public async Task Handle_AboveApprovalLimit_HoldsForReviewAndNotifiesAdmins()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 5000m);
        WasteSeed.SetApprovalLimit(_db, itemId, 500m);
        var reasonId = WasteSeed.Reason(_db, "Spilled or dropped");
        var adminId = WasteSeed.User(_db, AppRoles.Admin);
        var superId = WasteSeed.User(_db, AppRoles.SuperAdmin);
        WasteSeed.User(_db, AppRoles.Admin, active: false);
        WasteSeed.User(_db, AppRoles.StockManager);

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 600m, reasonId, null, null), default);

        result!.Status.ShouldBe("PendingReview");
        result.RequiresReview.ShouldBeTrue();
        StockSeed.Balance(_db, itemId).ShouldBe(4400m);
        await _notifications.Received(1).NotifyAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 2 && ids.Contains(adminId) && ids.Contains(superId)),
            Arg.Is<NotificationMessage>(m =>
                m.Kind == NotificationKinds.WasteReview
                && m.Severity == NotificationSeverity.Warning
                && m.Title == "Waste to review: Oat Milk"
                && m.Body == "600 ml recorded as Spilled or dropped, above the 500 ml limit."
                && m.Path == "/inventory/waste?status=PendingReview"
                && m.SubjectId == result.Id),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_AtApprovalLimit_IsNotHeld()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 5000m);
        WasteSeed.SetApprovalLimit(_db, itemId, 500m);
        var reasonId = WasteSeed.Reason(_db);
        WasteSeed.User(_db, AppRoles.Admin);

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 500m, reasonId, null, null), default);

        result!.Status.ShouldBe("Recorded");
        await _notifications.DidNotReceiveWithAnyArgs().NotifyAsync(default!, default!, default);
    }

    [Fact]
    public async Task Handle_AboveLimitWithNoReviewers_HoldsWithoutNotifying()
    {
        var itemId = StockSeed.Item(_db, "Oat Milk", 5000m);
        WasteSeed.SetApprovalLimit(_db, itemId, 100m);
        var reasonId = WasteSeed.Reason(_db);

        var result = await Handler().Handle(new RecordWasteCommand(itemId, 200m, reasonId, null, null), default);

        result!.Status.ShouldBe("PendingReview");
        await _notifications.DidNotReceiveWithAnyArgs().NotifyAsync(default!, default!, default);
    }

    private RecordWasteHandler Handler() =>
        new(TestDb.Create(_db), TestRequest.As(_userId, AppRoles.Cashier), _audit, _alerts, _notifications);
}
