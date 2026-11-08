namespace WTF.Api.Common.Tenancy;

public sealed class TenancyOptions
{
    public const string SectionName = "Tenancy";

    public bool LegacyTokensAreDefaultTenant { get; set; } = true;
}
