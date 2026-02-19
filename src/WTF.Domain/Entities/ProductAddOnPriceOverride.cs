using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ProductAddOnPriceOverride
{
    public Guid Id { get; set; }

    public Guid ProductId { get; set; }

    public Guid AddOnId { get; set; }

    public decimal Price { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual ProductAddOn ProductAddOn { get; set; } = null!;
}
