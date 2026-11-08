using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class PlatformAuditLog
{
    public Guid Id { get; set; }

    public Guid? PlatformAdminId { get; set; }

    public string? Username { get; set; }

    public string Action { get; set; } = null!;

    public Guid? TenantId { get; set; }

    public string? Details { get; set; }

    public string? IpAddress { get; set; }

    public DateTime Timestamp { get; set; }
}
