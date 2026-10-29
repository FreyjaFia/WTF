using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class WasteReviewHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _adminId = Guid.NewGuid();
    private readonly Guid _cashierId;
    private readonly Guid _itemId;
    private readonly int _reasonId;
    private readonly IAuditService _audit = TestFakes.Audit();

    public WasteReviewHandlerTests()
    {
        WasteSeed.User(_db, AppRoles.Admin, _adminId, first: "Ada", last: "Admin");
        _cashierId = WasteSeed.User(_db, AppRoles.Cashier, first: "Cara", last: "Cashier");
        _itemId = StockSeed.Item(_db, "Oat Milk", 500m);
        _reasonId = WasteSeed.Reason(_db);
    }

    [Fact]
    public async Task Confirm_PendingEntry_MarksConfirmedWithReviewerAndKeepsStock()
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: StockWasteStatuses.PendingReview);

        var result = await Confirm().Handle(new ConfirmWasteCommand(wasteId, "  checked bin  "), default);

        result.ShouldNotBeNull();
        result.Status.ShouldBe("Confirmed");
        result.ReviewNote.ShouldBe("checked bin");
        result.ReviewedByName.ShouldNotBeNull();
        result.ReviewedByName.ShouldContain("Ada");
        result.ReviewedAt.ShouldNotBeNull();
        StockSeed.Balance(_db, _itemId).ShouldBe(500m);

        await using var db = TestDb.Create(_db);
        var waste = await db.StockWastes.SingleAsync();
        waste.Status.ShouldBe(StockWasteStatuses.Confirmed);
        waste.ReviewedBy.ShouldBe(_adminId);
        await _audit.Received(1).LogAsync(
            AuditAction.StockWasteConfirmed,
            AuditEntityType.StockWaste,
            wasteId.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Confirm_WithoutNote_IsAllowed()
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: StockWasteStatuses.PendingReview);

        var result = await Confirm().Handle(new ConfirmWasteCommand(wasteId, "   "), default);

        result.ShouldNotBeNull();
        result.Status.ShouldBe("Confirmed");
        result.ReviewNote.ShouldBeNull();
    }

    [Fact]
    public async Task Dispute_WithNote_MarksDisputedAndAudits()
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: StockWasteStatuses.PendingReview);

        var result = await Dispute().Handle(new DisputeWasteCommand(wasteId, "too much"), default);

        result.ShouldNotBeNull();
        result.Status.ShouldBe("Disputed");
        result.ReviewNote.ShouldBe("too much");
        StockSeed.Balance(_db, _itemId).ShouldBe(500m);
        await _audit.Received(1).LogAsync(
            AuditAction.StockWasteDisputed,
            AuditEntityType.StockWaste,
            wasteId.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public async Task Dispute_WithoutNote_Throws(string? note)
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: StockWasteStatuses.PendingReview);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Dispute().Handle(new DisputeWasteCommand(wasteId, note), default));

        ex.Message.ShouldBe("Say why the entry is disputed.");
        await using var db = TestDb.Create(_db);
        (await db.StockWastes.SingleAsync()).Status.ShouldBe(StockWasteStatuses.PendingReview);
    }

    [Fact]
    public async Task Confirm_NoteTooLong_Throws()
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: StockWasteStatuses.PendingReview);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Confirm().Handle(new ConfirmWasteCommand(wasteId, new string('x', 501)), default));

        ex.Message.ShouldBe("The note can be at most 500 characters.");
    }

    [Fact]
    public async Task Confirm_UnknownEntry_ReturnsNull()
    {
        var result = await Confirm().Handle(new ConfirmWasteCommand(Guid.NewGuid(), null), default);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Theory]
    [InlineData(StockWasteStatuses.Recorded)]
    [InlineData(StockWasteStatuses.Confirmed)]
    [InlineData(StockWasteStatuses.Disputed)]
    [InlineData(StockWasteStatuses.Reversed)]
    public async Task Confirm_EntryNotWaitingForReview_Throws(byte status)
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Confirm().Handle(new ConfirmWasteCommand(wasteId, null), default));

        ex.Message.ShouldBe("Only an entry waiting for review can be confirmed or disputed.");
    }

    [Theory]
    [InlineData(StockWasteStatuses.Recorded)]
    [InlineData(StockWasteStatuses.Confirmed)]
    [InlineData(StockWasteStatuses.Reversed)]
    public async Task Dispute_EntryNotWaitingForReview_Throws(byte status)
    {
        var wasteId = WasteSeed.Entry(_db, _itemId, _reasonId, _cashierId, status: status);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Dispute().Handle(new DisputeWasteCommand(wasteId, "why"), default));

        ex.Message.ShouldBe("Only an entry waiting for review can be confirmed or disputed.");
    }

    private ConfirmWasteHandler Confirm() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit);

    private DisputeWasteHandler Dispute() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit);
}
