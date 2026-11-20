using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockTransferLine
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public Guid TransferId { get; set; }

    public Guid ItemId { get; set; }

    public decimal Quantity { get; set; }

    public decimal? UnitCost { get; set; }

    public virtual Item Item { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;

    public virtual StockTransfer Transfer { get; set; } = null!;
}
