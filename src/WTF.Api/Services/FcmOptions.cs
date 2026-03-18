namespace WTF.Api.Services;

public sealed class FcmOptions
{
    public const string SectionName = "Fcm";

    public string? ProjectId { get; set; }

    public string? ServiceAccountJsonPath { get; set; }

    public string? ServiceAccountJson { get; set; }
}
