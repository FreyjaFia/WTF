using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class OrderItem
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid ProductId { get; set; }

    public int Quantity { get; set; }

    public decimal? Price { get; set; }

    public Guid? ParentOrderItemId { get; set; }

    public virtual ICollection<OrderItem> InverseParentOrderItem { get; set; } = new List<OrderItem>();

    public virtual Order Order { get; set; } = null!;

    public virtual OrderItem? ParentOrderItem { get; set; }

    public virtual Product Product { get; set; } = null!;
}
