using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class FixedBundlePromotion
{
    public Guid PromotionId { get; set; }

    public decimal BundlePrice { get; set; }

    public virtual ICollection<FixedBundlePromotionItem> FixedBundlePromotionItems { get; set; } = new List<FixedBundlePromotionItem>();

    public virtual Promotion Promotion { get; set; } = null!;
}
