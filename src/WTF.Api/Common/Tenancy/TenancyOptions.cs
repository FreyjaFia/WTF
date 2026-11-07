namespace WTF.Api.Common.Tenancy;

public sealed class TenancyOptions
{
    public const string SectionName = "Tenancy";

    public const string SingleMode = "Single";

    public const string MultiMode = "Multi";

    public string Mode { get; set; } = SingleMode;

    public bool IsMulti => string.Equals(Mode, MultiMode, StringComparison.OrdinalIgnoreCase);

    public bool LegacyTokensAreDefaultTenant { get; set; } = true;
}
