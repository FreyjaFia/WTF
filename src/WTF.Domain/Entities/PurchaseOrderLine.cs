using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class PurchaseOrderLine
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public Guid PurchaseOrderId { get; set; }

    public Guid ItemId { get; set; }

    public string? PackName { get; set; }

    public decimal UnitsPerPack { get; set; }

    public decimal? PackPrice { get; set; }

    public decimal PacksOrdered { get; set; }

    public decimal PacksReceived { get; set; }

    public virtual Item Item { get; set; } = null!;

    public virtual PurchaseOrder PurchaseOrder { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
