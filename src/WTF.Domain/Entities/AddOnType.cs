using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class AddOnType
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public virtual ICollection<ProductAddOn> ProductAddOns { get; set; } = new List<ProductAddOn>();
}
