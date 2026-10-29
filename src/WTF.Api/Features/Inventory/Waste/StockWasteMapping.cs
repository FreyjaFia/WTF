using Microsoft.EntityFrameworkCore;
using System.Globalization;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Waste;

public static class StockWasteStatuses
{
    public const byte Recorded = 1;
    public const byte PendingReview = 2;
    public const byte Confirmed = 3;
    public const byte Disputed = 4;
    public const byte Reversed = 5;

    public const byte SourceItemDetails = 1;
    public const byte SourcePos = 2;

    public static string Name(byte status) => status switch
    {
        Recorded => nameof(Recorded),
        PendingReview => nameof(PendingReview),
        Confirmed => nameof(Confirmed),
        Disputed => nameof(Disputed),
        Reversed => nameof(Reversed),
        _ => "Unknown"
    };

    public static byte? Parse(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var trimmed = name.Trim();
        if (byte.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out var numeric)
            && numeric is >= Recorded and <= Reversed)
        {
            return numeric;
        }

        return trimmed.ToLowerInvariant() switch
        {
            "recorded" => Recorded,
            "pendingreview" => PendingReview,
            "confirmed" => Confirmed,
            "disputed" => Disputed,
            "reversed" => Reversed,
            _ => throw new InvalidOperationException("Unknown waste status.")
        };
    }
}

public static class StockWasteMapping
{
    public static IQueryable<StockWasteDto> Project(IQueryable<StockWaste> query) =>
        query.Select(w => new StockWasteDto(
            w.Id,
            w.ItemId,
            w.Item.Name,
            w.Item.UnitName,
            w.Quantity,
            w.WasteReasonId,
            w.ReasonName,
            w.Notes,
            w.Status == StockWasteStatuses.Recorded ? "Recorded"
                : w.Status == StockWasteStatuses.PendingReview ? "PendingReview"
                : w.Status == StockWasteStatuses.Confirmed ? "Confirmed"
                : w.Status == StockWasteStatuses.Disputed ? "Disputed"
                : "Reversed",
            w.RequiresReview,
            w.StockMovement.QuantityBefore,
            w.StockMovement.QuantityAfter,
            w.CreatedAt,
            w.CreatedBy,
            (w.CreatedByNavigation.FirstName + " " + w.CreatedByNavigation.LastName).Trim(),
            w.ReviewedAt,
            w.ReviewedByNavigation == null
                ? null
                : (w.ReviewedByNavigation.FirstName + " " + w.ReviewedByNavigation.LastName).Trim(),
            w.ReviewNote,
            w.ReversedAt,
            w.ReversedByNavigation == null
                ? null
                : (w.ReversedByNavigation.FirstName + " " + w.ReversedByNavigation.LastName).Trim(),
            w.ReversalReason,
            w.Source));

    public static Task<StockWasteDto?> LoadAsync(WTFDbContext db, Guid id, CancellationToken cancellationToken) =>
        Project(db.StockWastes.AsNoTracking().Where(w => w.Id == id)).FirstOrDefaultAsync(cancellationToken);

    public static string FormatQuantity(decimal quantity, string unitName) =>
        $"{quantity.ToString("0.###", CultureInfo.InvariantCulture)} {InventoryUnitLabels.Abbreviate(unitName)}";
}
