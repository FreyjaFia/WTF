using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class DiscountedProductPromotionAddOn
{
    public Guid Id { get; set; }

    public Guid DiscountedProductPromotionId { get; set; }

    public Guid AddOnProductId { get; set; }

    public int Quantity { get; set; }

    public virtual Product AddOnProduct { get; set; } = null!;

    public virtual DiscountedProductPromotion DiscountedProductPromotion { get; set; } = null!;
}
