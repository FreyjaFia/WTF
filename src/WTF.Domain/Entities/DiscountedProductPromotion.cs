using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class DiscountedProductPromotion
{
    public Guid Id { get; set; }

    public Guid PromotionId { get; set; }

    public Guid ProductId { get; set; }

    public decimal? FixedPrice { get; set; }

    public decimal? PercentOff { get; set; }

    public Guid TenantId { get; set; }

    public virtual ICollection<DiscountedProductPromotionAddOn> DiscountedProductPromotionAddOns { get; set; } = new List<DiscountedProductPromotionAddOn>();

    public virtual Product Product { get; set; } = null!;

    public virtual Promotion Promotion { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
