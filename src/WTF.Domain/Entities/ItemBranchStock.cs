using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ItemBranchStock
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public Guid ItemId { get; set; }

    public Guid BranchId { get; set; }

    public decimal CurrentQuantity { get; set; }

    public byte LastAlertStatus { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Branch Branch { get; set; } = null!;

    public virtual Item Item { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
