namespace WTF.Tests.Infrastructure;

internal sealed class FixedClock(DateTime utc) : TimeProvider
{
    public static readonly DateTime Today = new(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc);

    public DateTime Utc { get; set; } = utc;

    public override DateTimeOffset GetUtcNow() => new(Utc, TimeSpan.Zero);
}
