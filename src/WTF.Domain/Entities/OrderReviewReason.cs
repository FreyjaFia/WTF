using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class OrderReviewReason
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public int SortOrder { get; set; }

    public int? LineIndex { get; set; }

    public string Code { get; set; } = null!;

    public byte Severity { get; set; }

    public string? ExpectedValue { get; set; }

    public string? QuotedValue { get; set; }

    public string Text { get; set; } = null!;

    public Guid TenantId { get; set; }

    public virtual Order Order { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
