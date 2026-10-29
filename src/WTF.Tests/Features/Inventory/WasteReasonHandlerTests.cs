using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class WasteReasonHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _adminId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();

    [Fact]
    public async Task Create_TrimsNameAndSavesActiveCustomReason()
    {
        var result = await Create().Handle(new CreateWasteReasonCommand("  Burnt milk  ", true, 15), default);

        result.Name.ShouldBe("Burnt milk");
        result.RequiresNote.ShouldBeTrue();
        result.SortOrder.ShouldBe(15);
        result.IsActive.ShouldBeTrue();
        result.IsSystem.ShouldBeFalse();

        await using var db = TestDb.Create(_db);
        var saved = await db.WasteReasons.SingleAsync();
        saved.Name.ShouldBe("Burnt milk");
        saved.CreatedBy.ShouldBe(_adminId);
        await _audit.Received(1).LogAsync(
            AuditAction.WasteReasonCreated,
            AuditEntityType.WasteReason,
            saved.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_BlankName_Throws(string? name)
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateWasteReasonCommand(name, false, 0), default));

        ex.Message.ShouldBe("Enter a name for the reason.");
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Create_NameTooLong_Throws()
    {
        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateWasteReasonCommand(new string('a', 61), false, 0), default));

        ex.Message.ShouldBe("The reason name can be at most 60 characters.");
    }

    [Fact]
    public async Task Create_NameAtLimit_IsAccepted()
    {
        var result = await Create().Handle(new CreateWasteReasonCommand(new string('a', 60), false, 0), default);

        result.Name.Length.ShouldBe(60);
    }

    [Fact]
    public async Task Create_DuplicateNameIgnoringCase_Throws()
    {
        WasteSeed.Reason(_db, "Spilled or dropped");

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateWasteReasonCommand(" SPILLED OR DROPPED ", false, 0), default));

        ex.Message.ShouldBe("A reason named \"SPILLED OR DROPPED\" already exists.");
    }

    [Fact]
    public async Task Create_DuplicateOfInactiveReason_StillThrows()
    {
        WasteSeed.Reason(_db, "Old reason", active: false);

        await Should.ThrowAsync<InvalidOperationException>(
            () => Create().Handle(new CreateWasteReasonCommand("old reason", false, 0), default));
    }

    [Fact]
    public async Task Update_ChangesFieldsAndAudits()
    {
        var id = WasteSeed.Reason(_db, "Spilled", sortOrder: 10);

        var result = await Update().Handle(new UpdateWasteReasonCommand(id, " Spilled drink ", true, 3), default);

        result.ShouldNotBeNull();
        result.Name.ShouldBe("Spilled drink");
        result.RequiresNote.ShouldBeTrue();
        result.SortOrder.ShouldBe(3);

        await using var db = TestDb.Create(_db);
        var saved = await db.WasteReasons.SingleAsync(r => r.Id == id);
        saved.UpdatedBy.ShouldBe(_adminId);
        saved.UpdatedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.WasteReasonUpdated,
            AuditEntityType.WasteReason,
            id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Update_KeepingItsOwnNameInOtherCase_IsAllowed()
    {
        var id = WasteSeed.Reason(_db, "Spilled");

        var result = await Update().Handle(new UpdateWasteReasonCommand(id, "SPILLED", false, 1), default);

        result.ShouldNotBeNull();
        result.Name.ShouldBe("SPILLED");
    }

    [Fact]
    public async Task Update_NameOfAnotherReason_Throws()
    {
        WasteSeed.Reason(_db, "Expired");
        var id = WasteSeed.Reason(_db, "Spilled");

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Update().Handle(new UpdateWasteReasonCommand(id, "expired", false, 1), default));

        ex.Message.ShouldBe("A reason named \"expired\" already exists.");
    }

    [Fact]
    public async Task Update_Unknown_ReturnsNull()
    {
        var result = await Update().Handle(new UpdateWasteReasonCommand(999_999, "X", false, 0), default);

        result.ShouldBeNull();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Update_SystemReasonThatNeedsNote_CannotTurnNoteOff()
    {
        var id = WasteSeed.Reason(_db, "Other", requiresNote: true, system: true);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Update().Handle(new UpdateWasteReasonCommand(id, "Other", false, 0), default));

        ex.Message.ShouldBe("\"Other\" is a built-in reason and always needs a note.");
        await using var db = TestDb.Create(_db);
        (await db.WasteReasons.SingleAsync(r => r.Id == id)).RequiresNote.ShouldBeTrue();
    }

    [Fact]
    public async Task Update_SystemReason_CanBeRenamedAndReordered()
    {
        var id = WasteSeed.Reason(_db, "Expired or spoiled", system: true);

        var result = await Update().Handle(new UpdateWasteReasonCommand(id, "Spoiled", false, 2), default);

        result.ShouldNotBeNull();
        result.Name.ShouldBe("Spoiled");
        result.IsSystem.ShouldBeTrue();
    }

    [Fact]
    public async Task Deactivate_CustomReason_SetsInactiveAndAudits()
    {
        var id = WasteSeed.Reason(_db, "Staff meal");

        var result = await Deactivate().Handle(new DeactivateWasteReasonCommand(id), default);

        result.ShouldNotBeNull();
        result.IsActive.ShouldBeFalse();
        await using var db = TestDb.Create(_db);
        (await db.WasteReasons.SingleAsync(r => r.Id == id)).IsActive.ShouldBeFalse();
        await _audit.Received(1).LogAsync(
            AuditAction.WasteReasonDeactivated,
            AuditEntityType.WasteReason,
            id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Deactivate_SystemReason_Throws()
    {
        var id = WasteSeed.Reason(_db, "Other", system: true);

        var ex = await Should.ThrowAsync<InvalidOperationException>(
            () => Deactivate().Handle(new DeactivateWasteReasonCommand(id), default));

        ex.Message.ShouldBe("\"Other\" is a built-in reason and cannot be deactivated.");
        await using var db = TestDb.Create(_db);
        (await db.WasteReasons.SingleAsync(r => r.Id == id)).IsActive.ShouldBeTrue();
    }

    [Fact]
    public async Task Deactivate_AlreadyInactive_ReturnsWithoutAudit()
    {
        var id = WasteSeed.Reason(_db, "Staff meal", active: false);

        var result = await Deactivate().Handle(new DeactivateWasteReasonCommand(id), default);

        result.ShouldNotBeNull();
        result.IsActive.ShouldBeFalse();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Deactivate_Unknown_ReturnsNull()
    {
        (await Deactivate().Handle(new DeactivateWasteReasonCommand(999_999), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Restore_InactiveReason_ReactivatesAndAudits()
    {
        var id = WasteSeed.Reason(_db, "Staff meal", active: false);

        var result = await Restore().Handle(new RestoreWasteReasonCommand(id), default);

        result.ShouldNotBeNull();
        result.IsActive.ShouldBeTrue();
        await _audit.Received(1).LogAsync(
            AuditAction.WasteReasonRestored,
            AuditEntityType.WasteReason,
            id.ToString(),
            Arg.Any<object?>(),
            Arg.Any<object?>(),
            _adminId,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Restore_AlreadyActive_ReturnsWithoutAudit()
    {
        var id = WasteSeed.Reason(_db, "Staff meal");

        var result = await Restore().Handle(new RestoreWasteReasonCommand(id), default);

        result.ShouldNotBeNull();
        result.IsActive.ShouldBeTrue();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Restore_Unknown_ReturnsNull()
    {
        (await Restore().Handle(new RestoreWasteReasonCommand(999_999), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Get_ReturnsActiveOnlyOrderedBySortOrderThenName()
    {
        WasteSeed.Reason(_db, "Zeta", sortOrder: 1);
        WasteSeed.Reason(_db, "Alpha", sortOrder: 1);
        WasteSeed.Reason(_db, "First", sortOrder: 0);
        WasteSeed.Reason(_db, "Hidden", sortOrder: 0, active: false);

        var result = await new GetWasteReasonsHandler(TestDb.Create(_db)).Handle(new GetWasteReasonsQuery(), default);

        result.Select(r => r.Name).ShouldBe(["First", "Alpha", "Zeta"]);
    }

    [Fact]
    public async Task Get_IncludeInactive_ReturnsAll()
    {
        WasteSeed.Reason(_db, "Shown", sortOrder: 1);
        WasteSeed.Reason(_db, "Hidden", sortOrder: 0, active: false, system: true);

        var result = await new GetWasteReasonsHandler(TestDb.Create(_db)).Handle(new GetWasteReasonsQuery(true), default);

        result.Select(r => r.Name).ShouldBe(["Hidden", "Shown"]);
        result[0].IsActive.ShouldBeFalse();
        result[0].IsSystem.ShouldBeTrue();
    }

    private CreateWasteReasonHandler Create() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit);

    private UpdateWasteReasonHandler Update() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit);

    private DeactivateWasteReasonHandler Deactivate() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit);

    private RestoreWasteReasonHandler Restore() => new(TestDb.Create(_db), TestRequest.As(_adminId, AppRoles.Admin), _audit);
}
