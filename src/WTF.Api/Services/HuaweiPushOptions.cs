namespace WTF.Api.Services;

public sealed class HuaweiPushOptions
{
    public const string SectionName = "HuaweiPush";

    public string? AppId { get; set; }

    public string? AppSecret { get; set; }

    public string? OAuthEndpoint { get; set; }

    public string? PushEndpoint { get; set; }
}
