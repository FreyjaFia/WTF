namespace WTF.Api.Features.Images;

public sealed record StaleImageCleanupResult(
    DateTimeOffset RanAtUtc,
    bool DryRun,
    int RetentionDays,
    int OrphanFiles,
    int OrphanRows,
    int Deleted,
    int Failed,
    bool CapReached,
    bool Skipped,
    int MissingFileRows = 0);
