using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class MixMatchPromotion
{
    public Guid PromotionId { get; set; }

    public int RequiredQuantity { get; set; }

    public int? MaxSelectionsPerOrder { get; set; }

    public decimal BundlePrice { get; set; }

    public virtual ICollection<MixMatchPromotionProduct> MixMatchPromotionProducts { get; set; } = new List<MixMatchPromotionProduct>();

    public virtual Promotion Promotion { get; set; } = null!;
}
