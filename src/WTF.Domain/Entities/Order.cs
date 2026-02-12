using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Order
{
    public Guid Id { get; set; }

    public int OrderNumber { get; set; }

    public Guid? CustomerId { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public decimal? AmountReceived { get; set; }

    public decimal? ChangeAmount { get; set; }

    public decimal? Tips { get; set; }

    public int StatusId { get; set; }

    public int PaymentMethodId { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual User? Customer { get; set; }

    public virtual ICollection<OrderItem> OrderItems { get; set; } = new List<OrderItem>();

    public virtual PaymentMethod PaymentMethod { get; set; } = null!;

    public virtual Status Status { get; set; } = null!;

    public virtual User? UpdatedByNavigation { get; set; }
}
