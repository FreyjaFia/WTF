using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class FixedBundlePromotionItemAddOn
{
    public Guid Id { get; set; }

    public Guid FixedBundlePromotionItemId { get; set; }

    public Guid AddOnProductId { get; set; }

    public int Quantity { get; set; }

    public virtual Product AddOnProduct { get; set; } = null!;

    public virtual FixedBundlePromotionItem FixedBundlePromotionItem { get; set; } = null!;
}
