using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Promotion
{
    public Guid Id { get; set; }

    public string Name { get; set; } = null!;

    public int TypeId { get; set; }

    public bool IsActive { get; set; }

    public DateTime? StartDate { get; set; }

    public DateTime? EndDate { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual FixedBundlePromotion? FixedBundlePromotion { get; set; }

    public virtual MixMatchPromotion? MixMatchPromotion { get; set; }

    public virtual ICollection<OrderBundlePromotion> OrderBundlePromotions { get; set; } = new List<OrderBundlePromotion>();

    public virtual ICollection<OrderItem> OrderItems { get; set; } = new List<OrderItem>();

    public virtual PromotionImage? PromotionImage { get; set; }

    public virtual User? UpdatedByNavigation { get; set; }
}
