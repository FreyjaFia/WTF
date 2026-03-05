using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class MixMatchPromotionProductAddOn
{
    public Guid Id { get; set; }

    public Guid MixMatchPromotionProductId { get; set; }

    public Guid AddOnProductId { get; set; }

    public int Quantity { get; set; }

    public virtual Product AddOnProduct { get; set; } = null!;

    public virtual MixMatchPromotionProduct MixMatchPromotionProduct { get; set; } = null!;
}
