using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.IO.Compression;
using System.Text;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record ExportTenantQuery(Guid TenantId) : IRequest<TenantExport>;

public record TenantExport(string FileName, byte[] Content);

// One JSON file per table inside a zip. Passwords, refresh tokens and push tokens are left out; images are not included.
public class ExportTenantHandler(WTFDbContext db, IPlatformAuditService audit) : IRequestHandler<ExportTenantQuery, TenantExport>
{
    public async Task<TenantExport> Handle(ExportTenantQuery request, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("Shop not found.");

        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var table in TenantTables.For(db, forExport: true))
            {
                var columns = string.Join(", ", table.Columns.Select(c => $"[{c}]"));
                var sql = $"SELECT (SELECT {columns} FROM {table.Quoted} WHERE TenantId = @tenantId FOR JSON PATH, INCLUDE_NULL_VALUES) AS [Value]";
                var parts = await db.Database
                    .SqlQueryRaw<string>(sql, new SqlParameter("tenantId", tenant.Id))
                    .ToListAsync(cancellationToken);

                var json = parts.FirstOrDefault();
                if (string.IsNullOrEmpty(json))
                {
                    continue;
                }

                var entry = zip.CreateEntry($"{table.Name}.json");
                await using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
                await writer.WriteAsync(json);
            }

            var info = zip.CreateEntry("tenant.json");
            await using var infoWriter = new StreamWriter(info.Open(), new UTF8Encoding(false));
            await infoWriter.WriteAsync($"{{\"id\":\"{tenant.Id}\",\"name\":{System.Text.Json.JsonSerializer.Serialize(tenant.Name)},\"slug\":\"{tenant.Slug}\",\"exportedAt\":\"{DateTime.UtcNow:O}\"}}");
        }

        await audit.LogAsync(PlatformActions.TenantExported, tenant.Id, "Data export downloaded.", cancellationToken: cancellationToken);
        return new TenantExport($"{tenant.Slug}-export-{DateTime.UtcNow:yyyyMMdd-HHmm}.zip", stream.ToArray());
    }
}
