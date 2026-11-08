## Stale Image Cleanup [Completed]

**Implemented** in `Features/Images` (`StaleImageCleanupScheduler`, `StaleImageCleanupService`, `ImageReferences`),
settings under `StaleImageCleanup` in `appsettings*.json`. Differences from the plan below:

- **Cold start.** The app goes cold, so the scheduler does not just sleep until 02:00. Every pass (at least every 30
  minutes, and on startup) asks "is today's run due?": past the run time and the last run was not today (Manila time).
  The last run is saved as `system/stale-image-cleanup.json` in report storage, so it survives restarts and a cold
  start after 02:00 catches up at once. A failed run is retried (`RetryCount`/`RetryDelayMinutes`), never lost.
- **Dry run is on by default** in code and `appsettings.json` (cap `MaxDeletesPerRun: 100`). Check the logs, then set `DryRun` to `false`.
- **Scope.** `Categories` (default `["users"]`) limits the cleanup to `images/{category}/` folders; widen it later
  (`customers`, `products`, `promotions`). "In use" is always judged against every image row, whatever the scope.
- **Third pass.** An in-use image row whose file is gone from storage loses its link and row, so the owner simply has no
  image (`RemoveRowsWithMissingFile`). It needs a non-empty storage listing, and is skipped if no file matches any row.
- **URL matching.** `ImageKey` normalises saved URLs (encoding, slashes, container name, prefixes) and a file also counts
  as used if its file name (ends in a GUID) matches a row. If no file matches any row, the file pass deletes nothing.
- **No audit entry:** `AuditLogs.UserId` is required and a background job has no user, so the run is logged and its
  result is the saved JSON state instead. The optional "Run now" button is not built; `IStaleImageCleanupService.GetLastRunAsync` is ready for it.
- **Fixed on the way:** `AzureBlobImageStorage.DeleteAsync` used the URL path including the container name as the blob
  name, so deletes of saved images silently found nothing; it now strips the container. This is likely where existing orphan blobs came from.
- **Chat images:** add the new chat image reference to `ImageReferences.ReferencingEntities` and the `Unreferenced` query
  (a test fails if an entity referencing `Image` is missing from the list).

Remove images that nothing uses any more after a configurable number of days, so the blob storage does not grow
forever. Replaced or removed images currently delete the stored file and image rows right away (see the hard-delete
note under Inventory); this feature covers what that path misses: orphaned blobs (an upload that was never saved, a
failed delete, a removed product or promotion), and the chat images below once their messages expire.

- **Setting.** `StaleImageCleanup:RetentionDays` (default 30, `0` = disabled) in app settings, plus `Enabled` and the
  run time (default `02:00`, `Asia/Manila`), in the style of `MonthlyReportWorkbookScheduler`.
- **Hosted service** (`StaleImageCleanupScheduler`, registered next to the workbook scheduler in `Program.cs`). Once a
  day, two passes:
  1. **Blobs with no database row:** list the container, skip anything newer than `RetentionDays` (so an upload that is
     still being saved is never touched), delete the rest.
  2. **Image rows nothing points to** (no product, customer, user, promotion or chat message references them) older than
     `RetentionDays`: delete the blob, then the row.
- **Safety.** Dry-run mode that only logs what would be deleted (on for the first run), a cap on how many files one run
  may delete (stop and log if exceeded), never touch the shared logo or report folders, one audit entry per run with the
  counts.
- **Needs first:** one central list of every place that references an image (product, customer, user, promotion and
  chat), so a new feature cannot be forgotten, plus a test that fails when an entity with an image reference is missing
  from the list.
- **Tests.** A recent unreferenced blob is kept, an old one is deleted, a referenced one is never deleted at any age,
  `RetentionDays = 0` does nothing, the delete cap stops a run, a failing delete does not stop the others.
- Optional: a "Run cleanup now" button and the last run's result for SuperAdmin on a management page.

---

