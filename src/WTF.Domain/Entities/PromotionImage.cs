using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class PromotionImage
{
    public Guid PromotionId { get; set; }

    public Guid ImageId { get; set; }

    public virtual Image Image { get; set; } = null!;

    public virtual Promotion Promotion { get; set; } = null!;
}
