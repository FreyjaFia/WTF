using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record StockMovementLookups(
    IReadOnlyDictionary<Guid, int> OrderNumbers,
    IReadOnlyDictionary<Guid, string> ProductNames)
{
    public static StockMovementLookups Empty { get; } = new(new Dictionary<Guid, int>(), new Dictionary<Guid, string>());
}

internal static class StockMovementMapping
{
    public static async Task<StockMovementLookups> LoadLookupsAsync(
        WTFDbContext db, IEnumerable<StockMovement> movements, CancellationToken cancellationToken)
    {
        var list = movements.ToList();
        var orderIds = list
            .Where(m => m.ReferenceType == StockMovementTypes.OrderReference && m.ReferenceId.HasValue)
            .Select(m => m.ReferenceId!.Value)
            .Distinct()
            .ToList();
        var productIds = list
            .Where(m => m.ProductId.HasValue)
            .Select(m => m.ProductId!.Value)
            .Distinct()
            .ToList();

        var orderNumbers = orderIds.Count == 0
            ? new Dictionary<Guid, int>()
            : await db.Orders
                .AsNoTracking()
                .Where(o => orderIds.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, o => o.OrderNumber, cancellationToken);
        var productNames = productIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Products
                .AsNoTracking()
                .Where(p => productIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

        return new StockMovementLookups(orderNumbers, productNames);
    }

    public static StockMovementDto ToDto(StockMovement movement, StockMovementLookups lookups)
    {
        return new StockMovementDto(
            movement.Id,
            movement.ItemId,
            movement.MovementType,
            movement.QuantityDelta,
            movement.QuantityBefore,
            movement.QuantityAfter,
            movement.UnitCost,
            movement.ReferenceType,
            movement.ReferenceId,
            movement.Notes,
            movement.CreatedAt,
            movement.CreatedBy,
            $"{movement.CreatedByNavigation.FirstName} {movement.CreatedByNavigation.LastName}".Trim(),
            movement.ProductId,
            movement.ProductId.HasValue && lookups.ProductNames.TryGetValue(movement.ProductId.Value, out var productName)
                ? productName
                : null,
            movement.ReferenceType == StockMovementTypes.OrderReference
                && movement.ReferenceId.HasValue
                && lookups.OrderNumbers.TryGetValue(movement.ReferenceId.Value, out var orderNumber)
                    ? orderNumber
                    : null);
    }
}
