using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockCountLine
{
    public Guid Id { get; set; }

    public Guid CountId { get; set; }

    public Guid ItemId { get; set; }

    public decimal? CountedQuantity { get; set; }

    public decimal? ExpectedQuantity { get; set; }

    public DateTime? CountedAt { get; set; }

    public Guid? CountedBy { get; set; }

    public Guid? MovementId { get; set; }

    public Guid TenantId { get; set; }

    public virtual StockCount Count { get; set; } = null!;

    public virtual User? CountedByNavigation { get; set; }

    public virtual Item Item { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
