using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Images;

public interface IStaleImageCleanupService
{
    Task<StaleImageCleanupResult> RunAsync(CancellationToken cancellationToken);

    /// <summary>The result of the last run, kept in report storage so it survives restarts (the app sleeps when idle).</summary>
    Task<StaleImageCleanupResult?> GetLastRunAsync(CancellationToken cancellationToken);
}

public sealed class StaleImageCleanupService(
    WTFDbContext db,
    IImageStorage imageStorage,
    IReportFileStorage reportStorage,
    IOptions<StaleImageCleanupOptions> options,
    ILogger<StaleImageCleanupService> logger) : IStaleImageCleanupService
{
    public const string StatePath = "system/stale-image-cleanup.json";

    public async Task<StaleImageCleanupResult> RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var nowUtc = DateTimeOffset.UtcNow;
        if (!settings.Enabled || settings.RetentionDays <= 0)
        {
            logger.LogInformation("Stale image cleanup is disabled (Enabled={Enabled}, RetentionDays={Days}).", settings.Enabled, settings.RetentionDays);
            return new StaleImageCleanupResult(nowUtc, settings.DryRun, settings.RetentionDays, 0, 0, 0, 0, false, true);
        }

        var cutoff = nowUtc.AddDays(-settings.RetentionDays);
        var cap = Math.Max(1, settings.MaxDeletesPerRun);
        var deleted = 0;
        var failed = 0;
        var capReached = false;

        // Pass 1: files in storage that no Images row names. Anything newer than the cutoff is skipped, so an
        // upload that is still being saved is never touched.
        // Only the categories listed in settings are looked at (default: users). Everything else is left alone.
        var prefixes = settings.Categories
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => $"images/{c.Trim().Trim('/')}/")
            .ToList();
        bool InScope(string key) =>
            prefixes.Count == 0 || prefixes.Any(p => key.StartsWith(p, StringComparison.OrdinalIgnoreCase));

        var files = (await imageStorage.ListAsync(cancellationToken)).Where(f => InScope(f.Key)).ToList();
        var allUrls = await db.Images.Select(i => i.ImageUrl).ToListAsync(cancellationToken);

        // "Used" is judged against every row, in any category, so a file can never be deleted because of the scope.
        var knownKeys = allUrls.Select(imageStorage.GetKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var knownNames = allUrls.Select(ImageKey.FileName).ToHashSet(StringComparer.Ordinal);
        var urls = allUrls.Where(u => InScope(imageStorage.GetKey(u))).ToList();

        // A file counts as used if its path OR its file name matches a row. Saved names end in a random GUID, so a
        // name match is safe, and it keeps a different slash, encoding or prefix from ever making a used file look unused.
        bool IsKnown(StoredImageInfo f) => knownKeys.Contains(f.Key) || knownNames.Contains(ImageKey.FileName(f.Key));

        // If rows and files both exist but not one matches, the paths are in a shape we do not understand.
        // Delete nothing from the file pass rather than guess.
        var mismatch = urls.Count > 0 && files.Count > 0 && !files.Any(IsKnown);
        if (mismatch)
        {
            logger.LogWarning(
                "Stale image cleanup: none of {Files} stored files matches any of {Rows} image rows (example row {Row}, example file {File}). Skipping the file pass.",
                files.Count, urls.Count, urls[0], files[0].Key);
        }

        var orphanFiles = mismatch
            ? []
            : files
                .Where(f => f.LastModifiedUtc < cutoff && !IsKnown(f))
                .OrderBy(f => f.LastModifiedUtc)
                .ToList();

        foreach (var file in orphanFiles)
        {
            if (deleted >= cap)
            {
                capReached = true;
                break;
            }

            if (settings.DryRun)
            {
                logger.LogInformation("Stale image cleanup (dry run) would delete file {Key}.", file.Key);
                deleted++;
                continue;
            }

            try
            {
                await imageStorage.DeleteAsync(file.Url, cancellationToken);
                deleted++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failed++;
                logger.LogWarning(ex, "Stale image cleanup could not delete file {Key}.", file.Key);
            }
        }

        // Pass 2: Images rows nothing points to. The file goes first, then the row, so a failed delete leaves the
        // row for the next run instead of an untracked file.
        var orphanRows = (await ImageReferences.Unreferenced(db.Images)
                .Where(i => i.UploadedAt < cutoff.UtcDateTime)
                .OrderBy(i => i.UploadedAt)
                .ToListAsync(cancellationToken))
            .Where(i => InScope(imageStorage.GetKey(i.ImageUrl)))
            .ToList();

        foreach (var image in orphanRows)
        {
            if (capReached || deleted >= cap)
            {
                capReached = true;
                break;
            }

            if (settings.DryRun)
            {
                logger.LogInformation("Stale image cleanup (dry run) would delete image row {ImageId} ({Url}).", image.ImageId, image.ImageUrl);
                deleted++;
                continue;
            }

            try
            {
                await imageStorage.DeleteAsync(image.ImageUrl, cancellationToken);
                db.Images.Remove(image);
                await db.SaveChangesAsync(cancellationToken);
                deleted++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failed++;
                db.ChangeTracker.Clear();
                logger.LogWarning(ex, "Stale image cleanup could not delete image {ImageId}.", image.ImageId);
            }
        }

        // Pass 3: rows that are in use but whose file is gone from storage. Remove the link and the row, so the
        // product, customer, user or promotion simply has no image instead of a broken one. Only when storage clearly
        // answered (it listed files and they match the rows), and only for rows older than the cutoff.
        var missingFileRows = 0;
        if (settings.RemoveRowsWithMissingFile && files.Count > 0 && !mismatch && !capReached)
        {
            var fileKeys = files.Select(f => f.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var fileNames = files.Select(f => ImageKey.FileName(f.Key)).ToHashSet(StringComparer.Ordinal);

            var usedRows = (await ImageReferences.WithLinks(db.Images)
                    .Where(i => i.UploadedAt < cutoff.UtcDateTime)
                    .ToListAsync(cancellationToken))
                .Where(i => InScope(imageStorage.GetKey(i.ImageUrl)))
                .Where(i => ImageReferences.LinksOf(i).Any())
                .Where(i => !fileKeys.Contains(imageStorage.GetKey(i.ImageUrl)) && !fileNames.Contains(ImageKey.FileName(i.ImageUrl)))
                .OrderBy(i => i.UploadedAt)
                .ToList();
            missingFileRows = usedRows.Count;

            foreach (var image in usedRows)
            {
                if (deleted >= cap)
                {
                    capReached = true;
                    break;
                }

                if (settings.DryRun)
                {
                    logger.LogInformation("Stale image cleanup (dry run) would remove image {ImageId} ({Url}): its file is missing from storage.", image.ImageId, image.ImageUrl);
                    deleted++;
                    continue;
                }

                try
                {
                    db.RemoveRange(ImageReferences.LinksOf(image));
                    db.Images.Remove(image);
                    await db.SaveChangesAsync(cancellationToken);
                    logger.LogInformation("Stale image cleanup removed image {ImageId} ({Url}): its file was missing from storage.", image.ImageId, image.ImageUrl);
                    deleted++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    failed++;
                    db.ChangeTracker.Clear();
                    logger.LogWarning(ex, "Stale image cleanup could not remove image {ImageId}.", image.ImageId);
                }
            }
        }

        if (capReached)
        {
            logger.LogWarning("Stale image cleanup stopped at the limit of {Cap} deletions per run; the rest waits for the next run.", cap);
        }

        var result = new StaleImageCleanupResult(
            nowUtc, settings.DryRun, settings.RetentionDays, orphanFiles.Count, orphanRows.Count, deleted, failed, capReached, false, missingFileRows);
        logger.LogInformation(
            "Stale image cleanup finished: DryRun={DryRun}, orphan files={Files}, orphan rows={Rows}, deleted={Deleted}, failed={Failed}.",
            result.DryRun, result.OrphanFiles, result.OrphanRows, result.Deleted, result.Failed);

        await SaveStateAsync(result, cancellationToken);
        return result;
    }

    public async Task<StaleImageCleanupResult?> GetLastRunAsync(CancellationToken cancellationToken)
    {
        var bytes = await reportStorage.ReadAllBytesAsync(StatePath, cancellationToken);
        if (bytes is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<StaleImageCleanupResult>(bytes);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private Task SaveStateAsync(StaleImageCleanupResult result, CancellationToken cancellationToken) =>
        reportStorage.SaveAsync(
            StatePath,
            JsonSerializer.SerializeToUtf8Bytes(result),
            "application/json",
            result.RanAtUtc,
            cancellationToken);
}
