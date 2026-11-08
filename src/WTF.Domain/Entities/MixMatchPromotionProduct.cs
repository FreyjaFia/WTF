using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class MixMatchPromotionProduct
{
    public Guid Id { get; set; }

    public Guid MixMatchPromotionId { get; set; }

    public Guid ProductId { get; set; }

    public Guid TenantId { get; set; }

    public virtual MixMatchPromotion MixMatchPromotion { get; set; } = null!;

    public virtual ICollection<MixMatchPromotionProductAddOn> MixMatchPromotionProductAddOns { get; set; } = new List<MixMatchPromotionProductAddOn>();

    public virtual Product Product { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
