namespace WTF.Api.Features.Subscriptions;

public sealed class SubscriptionOptions
{
    public const string SectionName = "Subscription";

    public int DefaultGraceDays { get; set; } = 7;

    public int TrialDays { get; set; } = 30;

    public int LeaseMaxAgeDays { get; set; } = 7;

    // Optional PEM of a P-256 private key. Left empty, leases carry the dates unsigned and no key setup is needed; set it
    // together with the app's leasePublicKey to have the app check a signature.
    public string? LeaseSigningKeyPem { get; set; }
}

public sealed class SubscriptionRemindersOptions
{
    public const string SectionName = "SubscriptionReminders";

    public bool Enabled { get; set; } = true;

    public string TimeZoneId { get; set; } = "Asia/Manila";

    public int RunAtHour { get; set; } = 8;

    public int RunAtMinute { get; set; } = 0;

    public bool DryRun { get; set; } = true;

    public int RetryCount { get; set; } = 3;

    public int RetryDelayMinutes { get; set; } = 15;
}
