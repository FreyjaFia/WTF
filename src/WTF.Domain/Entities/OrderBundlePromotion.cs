using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class OrderBundlePromotion
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid PromotionId { get; set; }

    public int Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    public virtual Order Order { get; set; } = null!;

    public virtual Promotion Promotion { get; set; } = null!;
}
