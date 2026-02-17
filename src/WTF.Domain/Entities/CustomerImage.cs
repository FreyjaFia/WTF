using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class CustomerImage
{
    public Guid CustomerId { get; set; }

    public Guid ImageId { get; set; }

    public virtual Customer Customer { get; set; } = null!;

    public virtual Image Image { get; set; } = null!;
}
