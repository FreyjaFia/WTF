using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Branch
{
    public Guid Id { get; set; }

    public Guid TenantId { get; set; }

    public string Name { get; set; } = null!;

    public string Code { get; set; } = null!;

    public string? Address { get; set; }

    public string? Phone { get; set; }

    public string TimeZone { get; set; } = null!;

    public bool IsActive { get; set; }

    public bool IsMain { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual ICollection<AuditLog> AuditLogs { get; set; } = new List<AuditLog>();

    public virtual ICollection<Expense> Expenses { get; set; } = new List<Expense>();

    public virtual ICollection<OrderSeniorPwdDiscount> OrderSeniorPwdDiscounts { get; set; } = new List<OrderSeniorPwdDiscount>();

    public virtual ICollection<Order> Orders { get; set; } = new List<Order>();

    public virtual ICollection<PurchaseOrder> PurchaseOrders { get; set; } = new List<PurchaseOrder>();

    public virtual ICollection<ShortLink> ShortLinks { get; set; } = new List<ShortLink>();

    public virtual ICollection<UnsyncedOrder> UnsyncedOrders { get; set; } = new List<UnsyncedOrder>();

    public virtual ICollection<StockCount> StockCounts { get; set; } = new List<StockCount>();

    public virtual ICollection<StockMovement> StockMovements { get; set; } = new List<StockMovement>();

    public virtual ICollection<StockReceipt> StockReceipts { get; set; } = new List<StockReceipt>();

    public virtual ICollection<StockWaste> StockWastes { get; set; } = new List<StockWaste>();

    public virtual Tenant Tenant { get; set; } = null!;

    public virtual ICollection<UserBranch> UserBranches { get; set; } = new List<UserBranch>();

    public virtual ICollection<User> Users { get; set; } = new List<User>();
}
