using WTF.Domain.Tenancy;

namespace WTF.Domain.Entities;

public partial class TenantSettings : ITenantOwned
{
    public Guid TenantId { get; set; }

    public string ShopName { get; set; } = null!;

    public string? ShortName { get; set; }

    public string? Tagline { get; set; }

    public string? LogoUrl { get; set; }

    public string? Address { get; set; }

    public string? Phone { get; set; }

    public string? Email { get; set; }

    public string? ReceiptHeader { get; set; }

    public string? ReceiptFooter { get; set; }

    public string? RegistrationText { get; set; }

    public string PrimaryColor { get; set; } = null!;

    public string TimeZone { get; set; } = null!;

    public string CurrencySymbol { get; set; } = null!;

    public string CurrencyCode { get; set; } = null!;

    public int CurrencyDecimals { get; set; }

    public DateTime? UpdatedAt { get; set; }
}
