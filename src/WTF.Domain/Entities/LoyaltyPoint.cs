using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class LoyaltyPoint
{
    public Guid Id { get; set; }

    public Guid CustomerId { get; set; }

    public int Points { get; set; }

    public virtual Customer Customer { get; set; } = null!;
}
