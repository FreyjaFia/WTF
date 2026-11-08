using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ItemSupplierPriceHistory
{
    public Guid Id { get; set; }

    public Guid ItemSupplierId { get; set; }

    public decimal? OldPackPrice { get; set; }

    public decimal NewPackPrice { get; set; }

    public string Source { get; set; } = null!;

    public DateTime ChangedAt { get; set; }

    public Guid ChangedBy { get; set; }

    public Guid TenantId { get; set; }

    public virtual User ChangedByNavigation { get; set; } = null!;

    public virtual ItemSupplier ItemSupplier { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
