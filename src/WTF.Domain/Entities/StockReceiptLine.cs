using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class StockReceiptLine
{
    public Guid Id { get; set; }

    public Guid ReceiptId { get; set; }

    public Guid ItemId { get; set; }

    public string? PackName { get; set; }

    public decimal Packs { get; set; }

    public decimal UnitsPerPack { get; set; }

    public decimal? PackPrice { get; set; }

    public decimal Quantity { get; set; }

    public decimal? UnitCost { get; set; }

    public Guid? MovementId { get; set; }

    public Guid TenantId { get; set; }

    public virtual Item Item { get; set; } = null!;

    public virtual StockReceipt Receipt { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
