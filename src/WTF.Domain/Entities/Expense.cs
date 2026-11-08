namespace WTF.Domain.Entities;

public partial class Expense
{
    public Guid Id { get; set; }

    public DateOnly ExpenseDate { get; set; }

    public byte Category { get; set; }

    public decimal Amount { get; set; }

    public string? Note { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual User? UpdatedByNavigation { get; set; }
}
