namespace WTF.Api.Features.Inventory.DTOs;

public record OrderStockMovementDto(
    Guid Id,
    Guid ItemId,
    string ItemName,
    string UnitName,
    Guid? ProductId,
    string? ProductName,
    string MovementType,
    decimal QuantityDelta,
    decimal QuantityBefore,
    decimal QuantityAfter,
    string? Notes,
    DateTime CreatedAt);
