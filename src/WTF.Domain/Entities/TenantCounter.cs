using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class TenantCounter
{
    public Guid TenantId { get; set; }

    public string Name { get; set; } = null!;

    public long NextValue { get; set; }

    public virtual Tenant Tenant { get; set; } = null!;
}
