using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ProductImage
{
    public Guid ProductId { get; set; }

    public Guid ImageId { get; set; }

    public virtual Image Image { get; set; } = null!;

    public virtual Product Product { get; set; } = null!;
}
