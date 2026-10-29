using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Waste;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

internal static class WasteSeed
{
    private static int _nextReasonId = 100;

    public static int Reason(
        string dbName,
        string name = "Spilled or dropped",
        bool requiresNote = false,
        bool system = false,
        bool active = true,
        int sortOrder = 10)
    {
        using var db = TestDb.Create(dbName);
        var reason = new WasteReason
        {
            Id = Interlocked.Increment(ref _nextReasonId),
            Name = name,
            RequiresNote = requiresNote,
            IsSystem = system,
            IsActive = active,
            SortOrder = sortOrder,
            CreatedAt = DateTime.UtcNow
        };
        db.WasteReasons.Add(reason);
        db.SaveChanges();
        return reason.Id;
    }

    public static Guid User(string dbName, string roleName, Guid? id = null, bool active = true, string first = "Ana", string last = "Staff")
    {
        using var db = TestDb.Create(dbName);
        var role = db.UserRoles.FirstOrDefault(r => r.Name == roleName);
        if (role is null)
        {
            role = new UserRole { Id = db.UserRoles.Select(r => r.Id).ToList().DefaultIfEmpty(0).Max() + 1, Name = roleName };
            db.UserRoles.Add(role);
        }

        var user = new User
        {
            Id = id ?? Guid.NewGuid(),
            Username = "u" + Guid.NewGuid().ToString("N"),
            PasswordHash = "x",
            FirstName = first,
            LastName = last,
            IsActive = active,
            RoleId = role.Id,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    public static Guid Entry(
        string dbName,
        Guid itemId,
        int reasonId,
        Guid createdBy,
        decimal quantity = 100m,
        byte status = StockWasteStatuses.Recorded,
        DateTime? createdAt = null,
        string reasonName = "Spilled or dropped")
    {
        using var db = TestDb.Create(dbName);
        var when = createdAt ?? DateTime.UtcNow;
        var wasteId = Guid.NewGuid();
        var movement = new StockMovement
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            MovementType = StockMovementTypes.Waste,
            QuantityDelta = -quantity,
            QuantityBefore = 1000m,
            QuantityAfter = 1000m - quantity,
            ReferenceType = StockMovementTypes.StockWasteReference,
            ReferenceId = wasteId,
            Notes = reasonName,
            CreatedAt = when,
            CreatedBy = createdBy
        };
        var waste = new StockWaste
        {
            Id = wasteId,
            ItemId = itemId,
            StockMovementId = movement.Id,
            Quantity = quantity,
            WasteReasonId = reasonId,
            ReasonName = reasonName,
            Status = status,
            RequiresReview = status == StockWasteStatuses.PendingReview,
            Source = StockWasteStatuses.SourceItemDetails,
            CreatedAt = when,
            CreatedBy = createdBy
        };
        db.StockMovements.Add(movement);
        db.StockWastes.Add(waste);
        db.SaveChanges();
        return wasteId;
    }

    public static void SetApprovalLimit(string dbName, Guid itemId, decimal? limit)
    {
        using var db = TestDb.Create(dbName);
        db.Items.Single(i => i.Id == itemId).WasteApprovalLimit = limit;
        db.SaveChanges();
    }
}
