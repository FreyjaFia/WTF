using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Conversations;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Platform;

public record GetDeletionPreviewQuery(Guid TenantId) : IRequest<DeletionPreviewDto>;

public record DeleteTenantCommand(Guid TenantId, string Slug, string AdminPassword) : IRequest<DeletionPreviewDto>;

public class GetDeletionPreviewHandler(WTFDbContext db) : IRequestHandler<GetDeletionPreviewQuery, DeletionPreviewDto>
{
    public async Task<DeletionPreviewDto> Handle(GetDeletionPreviewQuery request, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("Shop not found.");

        var counts = new Dictionary<string, int>();
        foreach (var table in TenantTables.For(db, forExport: false))
        {
            var count = await db.Database
                .SqlQueryRaw<int>($"SELECT COUNT(*) AS [Value] FROM {table.Quoted} WHERE TenantId = @tenantId", new SqlParameter("tenantId", tenant.Id))
                .SingleAsync(cancellationToken);
            if (count > 0)
            {
                counts[table.Name] = count;
            }
        }

        return new DeletionPreviewDto(tenant.Id, tenant.Slug, tenant.Status, counts);
    }
}

// Removes a shop and everything it owns. Only a suspended or cancelled shop can go, only after typing its address and the
// platform admin's password, and a small tombstone stays so the address cannot be reused by mistake.
public class DeleteTenantHandler(
    WTFDbContext db,
    IPlatformAuditService audit,
    TenantStatusCache statusCache,
    IHttpContextAccessor httpContextAccessor,
    IImageStorage imageStorage,
    IChatImageStore chatImageStore,
    ILogger<DeleteTenantHandler> logger) : IRequestHandler<DeleteTenantCommand, DeletionPreviewDto>
{
    public async Task<DeletionPreviewDto> Handle(DeleteTenantCommand request, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("Shop not found.");

        if (tenant.Id == TenantDefaults.DefaultTenantId)
        {
            throw new InvalidOperationException("The first shop cannot be deleted.");
        }

        if (tenant.Status is not (TenantAccess.Suspended or TenantAccess.Cancelled))
        {
            throw new InvalidOperationException("Suspend or cancel the shop first.");
        }

        if (!string.Equals(request.Slug?.Trim(), tenant.Slug, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The typed shop address does not match.");
        }

        var adminName = await VerifyAdminAsync(request.AdminPassword, cancellationToken);

        var preview = await new GetDeletionPreviewHandler(db).Handle(new GetDeletionPreviewQuery(tenant.Id), cancellationToken);
        var chatKeys = await db.ConversationMessages.IgnoreQueryFilters()
            .Where(m => m.TenantId == tenant.Id && m.ImageKey != null)
            .Select(m => m.ImageKey!)
            .ToListAsync(cancellationToken);

        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            await DeleteRowsAsync(tenant.Id, cancellationToken);

            db.TenantTombstones.Add(new TenantTombstone
            {
                TenantId = tenant.Id,
                Slug = tenant.Slug,
                Name = tenant.Name,
                DeletedAt = DateTime.UtcNow,
                DeletedBy = adminName,
                RowCounts = JsonSerializer.Serialize(preview.RowCounts)
            });
            db.Tenants.Remove(tenant);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        statusCache.Forget(tenant.Id);
        var failedFiles = await DeleteFilesAsync(tenant.Id, chatKeys, cancellationToken);

        await audit.LogAsync(
            PlatformActions.TenantDeleted,
            tenant.Id,
            $"Deleted '{tenant.Name}' ({tenant.Slug}); {preview.RowCounts.Values.Sum()} rows" + (failedFiles > 0 ? $"; {failedFiles} files could not be removed." : "."),
            cancellationToken: cancellationToken);

        return preview;
    }

    private async Task<string> VerifyAdminAsync(string password, CancellationToken cancellationToken)
    {
        var claim = httpContextAccessor.HttpContext?.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)
            ?? httpContextAccessor.HttpContext?.User.FindFirst("sub");

        if (!Guid.TryParse(claim?.Value, out var adminId))
        {
            throw new InvalidOperationException("Only a platform admin can delete a shop.");
        }

        var admin = await db.PlatformAdmins.AsNoTracking().FirstOrDefaultAsync(a => a.Id == adminId && a.IsActive, cancellationToken);
        if (admin is null || string.IsNullOrEmpty(password) || !BCrypt.Net.BCrypt.Verify(password, admin.PasswordHash))
        {
            throw new InvalidOperationException("Your password is not correct.");
        }

        return admin.Username;
    }

    // Children before parents: try every table, keep going while some deletes succeed, and fail (rolling back) if a loop makes no progress.
    private async Task DeleteRowsAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var pending = TenantTables.For(db, forExport: false);
        while (pending.Count > 0)
        {
            var failed = new List<TenantTable>();
            foreach (var table in pending)
            {
                try
                {
                    await db.Database.ExecuteSqlRawAsync(
                        $"DELETE FROM {table.Quoted} WHERE TenantId = @tenantId",
                        [new SqlParameter("tenantId", tenantId)],
                        cancellationToken);
                }
                catch (Exception ex) when (IsForeignKeyViolation(ex))
                {
                    failed.Add(table);
                }
            }

            if (failed.Count == pending.Count)
            {
                throw new InvalidOperationException($"Could not delete the shop's rows in: {string.Join(", ", failed.Select(t => t.Name))}.");
            }

            pending = failed;
        }

        foreach (var table in new[] { "TenantCounters", "TenantInvoices", "TenantSubscriptions" })
        {
            await db.Database.ExecuteSqlRawAsync(
                $"DELETE FROM dbo.{table} WHERE TenantId = @tenantId",
                [new SqlParameter("tenantId", tenantId)],
                cancellationToken);
        }
    }

    private static bool IsForeignKeyViolation(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            if (e is SqlException { Number: 547 })
            {
                return true;
            }

            if (e.InnerException is null)
            {
                break;
            }
        }

        return false;
    }

    private async Task<int> DeleteFilesAsync(Guid tenantId, List<string> chatKeys, CancellationToken cancellationToken)
    {
        var failures = 0;
        db.UseTenant(tenantId);

        try
        {
            foreach (var file in await imageStorage.ListAsync(cancellationToken))
            {
                try
                {
                    await imageStorage.DeleteAsync(file.Url, cancellationToken);
                }
                catch (Exception ex)
                {
                    failures++;
                    logger.LogWarning(ex, "Could not delete image {Key} of deleted shop {TenantId}", file.Key, tenantId);
                }
            }
        }
        catch (Exception ex)
        {
            failures++;
            logger.LogWarning(ex, "Could not list images of deleted shop {TenantId}", tenantId);
        }

        foreach (var key in chatKeys)
        {
            try
            {
                await chatImageStore.DeleteAsync(key, cancellationToken);
            }
            catch (Exception ex)
            {
                failures++;
                logger.LogWarning(ex, "Could not delete chat image {Key} of deleted shop {TenantId}", key, tenantId);
            }
        }

        return failures;
    }
}
