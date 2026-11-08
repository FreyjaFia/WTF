using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class TenantInvoice
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public int PlanId { get; set; }

    public DateTime PeriodStart { get; set; }

    public DateTime PeriodEnd { get; set; }

    public int Months { get; set; }

    public decimal Amount { get; set; }

    public byte Status { get; set; }

    public string? Reference { get; set; }

    public DateTime? DueDate { get; set; }

    public DateTime? PaidAt { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Plan Plan { get; set; } = null!;

    public virtual Tenant Tenant { get; set; } = null!;
}
