using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class CustomerImage
{
    public Guid CustomerId { get; set; }

    public Guid ImageId { get; set; }

    public Guid TenantId { get; set; }

    public virtual Customer Customer { get; set; } = null!;

    public virtual Image Image { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
