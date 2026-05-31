using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockMovement
{
    public Guid Id { get; set; }

    public Guid InventoryItemId { get; set; }

    public string MovementType { get; set; } = null!;

    public decimal QuantityDelta { get; set; }

    public decimal QuantityBefore { get; set; }

    public decimal QuantityAfter { get; set; }

    public decimal? UnitCost { get; set; }

    public string? ReferenceType { get; set; }

    public Guid? ReferenceId { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual InventoryItem InventoryItem { get; set; } = null!;
}
