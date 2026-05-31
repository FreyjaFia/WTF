using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ProductInventoryLink
{
    public Guid Id { get; set; }

    public Guid ProductId { get; set; }

    public Guid InventoryItemId { get; set; }

    public decimal QuantityPerSale { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual InventoryItem InventoryItem { get; set; } = null!;

    public virtual Product Product { get; set; } = null!;

    public virtual User? UpdatedByNavigation { get; set; }
}
