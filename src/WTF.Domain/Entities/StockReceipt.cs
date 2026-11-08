using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockReceipt
{
    public Guid Id { get; set; }

    public Guid SupplierId { get; set; }

    public DateOnly ReceivedOn { get; set; }

    public string? InvoiceNumber { get; set; }

    public decimal? InvoiceTotal { get; set; }

    public string? Note { get; set; }

    public Guid? ClientRequestId { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public Guid TenantId { get; set; }

    public Guid? PurchaseOrderId { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual PurchaseOrder? PurchaseOrder { get; set; }

    public virtual ICollection<StockReceiptLine> StockReceiptLines { get; set; } = new List<StockReceiptLine>();

    public virtual Supplier Supplier { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
