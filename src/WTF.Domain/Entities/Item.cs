using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Item
{
    public Guid Id { get; set; }

    public string Name { get; set; } = null!;

    public string? Sku { get; set; }

    public string? Barcode { get; set; }

    public string UnitName { get; set; } = null!;

    public decimal CurrentQuantity { get; set; }

    public decimal? CostPrice { get; set; }

    public decimal? WarningQuantity { get; set; }

    public decimal? CriticalQuantity { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public string? StockUnitName { get; set; }

    public decimal? UnitsPerStockUnit { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual ICollection<ProductItemLink> ProductItemLinks { get; set; } = new List<ProductItemLink>();

    public virtual ICollection<StockMovement> StockMovements { get; set; } = new List<StockMovement>();

    public virtual User? UpdatedByNavigation { get; set; }
}
