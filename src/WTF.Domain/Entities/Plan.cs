namespace WTF.Domain.Entities;

public partial class Plan
{
    public int Id { get; set; }

    public string Code { get; set; } = null!;

    public string Name { get; set; } = null!;

    public decimal MonthlyPrice { get; set; }

    public string Features { get; set; } = string.Empty;

    public int? MaxUsers { get; set; }

    public bool IsActive { get; set; }

    public int SortOrder { get; set; }
}
