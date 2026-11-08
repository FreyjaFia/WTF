using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class TenantTombstone
{
    public Guid TenantId { get; set; }

    public string Slug { get; set; } = null!;

    public string Name { get; set; } = null!;

    public DateTime DeletedAt { get; set; }

    public string DeletedBy { get; set; } = null!;

    public string? RowCounts { get; set; }
}
