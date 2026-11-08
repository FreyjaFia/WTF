using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class PurchaseOrder
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public int PoNumber { get; set; }

    public Guid SupplierId { get; set; }

    public byte Status { get; set; }

    public DateOnly? ExpectedOn { get; set; }

    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? SentAt { get; set; }

    public Guid? SentBy { get; set; }

    public DateTime? ClosedAt { get; set; }

    public Guid? ClosedBy { get; set; }

    public virtual User? ClosedByNavigation { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual ICollection<PurchaseOrderLine> PurchaseOrderLines { get; set; } = new List<PurchaseOrderLine>();

    public virtual User? SentByNavigation { get; set; }

    public virtual ICollection<StockReceipt> StockReceipts { get; set; } = new List<StockReceipt>();

    public virtual Supplier Supplier { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
