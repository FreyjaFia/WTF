using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class TenantSubscription
{
    public Guid TenantId { get; set; }

    public int PlanId { get; set; }

    public DateTime CurrentPeriodStart { get; set; }

    public DateTime CurrentPeriodEnd { get; set; }

    public int GraceDays { get; set; }

    public decimal DiscountPercent { get; set; }

    public string? Notes { get; set; }

    public DateOnly? ReminderSentOn { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public virtual Plan Plan { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
