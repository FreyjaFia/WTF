using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockMovement
{
    public Guid Id { get; set; }

    public Guid ItemId { get; set; }

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

    public Guid? ProductId { get; set; }

    public Guid? OrderItemId { get; set; }

    public Guid TenantId { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Item Item { get; set; } = null!;

    public virtual Product? Product { get; set; }

    public virtual ICollection<StockWaste> StockWasteReversalMovements { get; set; } = new List<StockWaste>();

    public virtual ICollection<StockWaste> StockWasteStockMovements { get; set; } = new List<StockWaste>();

    public virtual Tenant Tenant { get; set; } = null!;
}
