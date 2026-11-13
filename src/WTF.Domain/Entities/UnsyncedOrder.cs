using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class UnsyncedOrder
{
    public Guid Id { get; set; }

    public string OfflineLocalId { get; set; } = null!;

    public string QuotedOrderJson { get; set; } = null!;

    public string ErrorText { get; set; } = null!;

    public string ErrorCode { get; set; } = null!;

    public Guid CashierUserId { get; set; }

    public DateTime? DeviceCreatedAt { get; set; }

    public DateTime ReceivedAt { get; set; }

    public decimal? QuotedTotal { get; set; }

    public byte StatusId { get; set; }

    public byte? Resolution { get; set; }

    public Guid? ResolvedBy { get; set; }

    public DateTime? ResolvedAt { get; set; }

    public string? DiscardReason { get; set; }

    public Guid? ResultingOrderId { get; set; }

    public Guid TenantId { get; set; }

    public virtual User CashierUser { get; set; } = null!;

    public virtual User? ResolvedByNavigation { get; set; }

    public virtual Order? ResultingOrder { get; set; }

    public virtual Tenant Tenant { get; set; } = null!;
}
