using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Platform;

public sealed record TenantTable(string Schema, string Name, IReadOnlyList<string> Columns)
{
    public string Quoted => $"[{Schema}].[{Name}]";
}

// The tables that hold one shop's rows, read from the model so a new tenant-owned table is picked up by export and delete.
public static class TenantTables
{
    private static readonly HashSet<string> SecretColumns = new(StringComparer.OrdinalIgnoreCase) { "PasswordHash", "Token" };

    private static readonly HashSet<string> NeverExported = new(StringComparer.OrdinalIgnoreCase) { "RefreshTokens", "PushTokens", "DeviceTokens" };

    public static List<TenantTable> For(WTFDbContext db, bool forExport)
    {
        var tables = new List<TenantTable>();
        foreach (var entityType in db.Model.GetEntityTypes())
        {
            if (!typeof(ITenantOwned).IsAssignableFrom(entityType.ClrType) || entityType.GetTableName() is not { } name)
            {
                continue;
            }

            if (forExport && NeverExported.Contains(name))
            {
                continue;
            }

            var schema = entityType.GetSchema() ?? "dbo";
            var columns = entityType.GetProperties()
                .Select(p => p.GetColumnName())
                .Where(c => !forExport || !SecretColumns.Contains(c))
                .ToList();
            tables.Add(new TenantTable(schema, name, columns));
        }

        return [.. tables.DistinctBy(t => t.Quoted).OrderBy(t => t.Name)];
    }
}
