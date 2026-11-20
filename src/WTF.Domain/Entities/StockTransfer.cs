using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockTransfer
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public Guid FromBranchId { get; set; }

    public Guid ToBranchId { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual Branch FromBranch { get; set; } = null!;

    public virtual ICollection<StockTransferLine> StockTransferLines { get; set; } = new List<StockTransferLine>();

    public virtual Tenant Tenant { get; set; } = null!;

    public virtual Branch ToBranch { get; set; } = null!;
}
