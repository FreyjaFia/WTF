using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ProductPriceHistory
{
    public Guid Id { get; set; }

    public Guid ProductId { get; set; }

    public decimal? OldPrice { get; set; }

    public decimal NewPrice { get; set; }

    public DateTime UpdatedAt { get; set; }

    public Guid UpdatedBy { get; set; }

    public virtual Product Product { get; set; } = null!;

    public virtual User UpdatedByNavigation { get; set; } = null!;
}
