using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ItemPriceHistory
{
    public Guid Id { get; set; }

    public Guid ItemId { get; set; }

    public decimal? OldPrice { get; set; }

    public decimal NewPrice { get; set; }

    public DateTime UpdatedAt { get; set; }

    public Guid UpdatedBy { get; set; }

    public virtual Item Item { get; set; } = null!;

    public virtual User UpdatedByNavigation { get; set; } = null!;
}
