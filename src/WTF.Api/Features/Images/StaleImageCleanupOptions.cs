namespace WTF.Api.Features.Images;

public sealed class StaleImageCleanupOptions
{
    public const string SectionName = "StaleImageCleanup";

    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Image folders to clean, as in <c>images/{category}/</c> (customers, users, products, promotions).
    /// Anything not listed is never touched. Empty means all of them. Start small and widen it later.
    /// </summary>
    public string[] Categories { get; set; } = ["users"];

    /// <summary>Images newer than this are never touched. <c>0</c> disables the cleanup.</summary>
    public int RetentionDays { get; set; } = 30;

    public string TimeZoneId { get; set; } = "Asia/Manila";

    public int RunAtHour { get; set; } = 2;

    public int RunAtMinute { get; set; } = 0;

    /// <summary>Only log what would be deleted. On by default so the first runs can be checked before anything is removed.</summary>
    public bool DryRun { get; set; } = true;

    /// <summary>
    /// Also remove image rows whose file is gone from storage, so the product/customer/user/promotion simply has no
    /// image instead of a broken link. Skipped when storage lists no files or no file matches any row.
    /// </summary>
    public bool RemoveRowsWithMissingFile { get; set; } = true;

    /// <summary>One run stops (and logs) once it has deleted this many files or rows.</summary>
    public int MaxDeletesPerRun { get; set; } = 100;

    public int RetryCount { get; set; } = 3;

    public int RetryDelayMinutes { get; set; } = 15;
}
