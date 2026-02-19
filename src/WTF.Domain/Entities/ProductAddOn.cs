using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ProductAddOn
{
    public Guid ProductId { get; set; }

    public Guid AddOnId { get; set; }

    public int? AddOnTypeId { get; set; }

    public virtual Product AddOn { get; set; } = null!;

    public virtual AddOnType? AddOnType { get; set; }

    public virtual Product Product { get; set; } = null!;

    public virtual ProductAddOnPriceOverride? ProductAddOnPriceOverride { get; set; }
}
