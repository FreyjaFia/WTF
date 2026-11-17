using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class UserBranch
{
    public Guid UserId { get; set; }

    public Guid BranchId { get; set; }

    public Guid TenantId { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Branch Branch { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
