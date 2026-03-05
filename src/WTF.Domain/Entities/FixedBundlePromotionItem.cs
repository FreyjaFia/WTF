using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class FixedBundlePromotionItem
{
    public Guid Id { get; set; }

    public Guid FixedBundlePromotionId { get; set; }

    public Guid ProductId { get; set; }

    public int Quantity { get; set; }

    public virtual FixedBundlePromotion FixedBundlePromotion { get; set; } = null!;

    public virtual ICollection<FixedBundlePromotionItemAddOn> FixedBundlePromotionItemAddOns { get; set; } = new List<FixedBundlePromotionItemAddOn>();

    public virtual Product Product { get; set; } = null!;
}
