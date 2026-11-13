using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class OfflineSyncPolicy
{
    public Guid TenantId { get; set; }

    public byte PriceChangedMode { get; set; }

    public byte AddOnPriceChangedMode { get; set; }

    public byte ProductInactiveMode { get; set; }

    public byte BundleChangedMode { get; set; }

    public byte CustomerInactiveMode { get; set; }

    public byte PromotionEndedMode { get; set; }

    public byte UnknownProductMode { get; set; }

    public decimal PriceTolerance { get; set; }

    public bool AutoApproveNotes { get; set; }

    public int AgedAfterDays { get; set; }

    public DateTime UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual Tenant Tenant { get; set; } = null!;

    public virtual User? UpdatedByNavigation { get; set; }
}
