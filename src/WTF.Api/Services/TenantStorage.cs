using System.Text.RegularExpressions;
using WTF.Api.Features.Conversations;
using WTF.Domain.Tenancy;

namespace WTF.Api.Services;

// Every tenant's files live under its own {tenantId}/ folder. Files saved before tenants existed have no such folder and
// belong to the first tenant, so that tenant can still read and delete them.
public static partial class TenantStorage
{
    public static string Segment(ICurrentTenant tenant)
    {
        var id = tenant.StampTenantId is { } stamp && stamp != Guid.Empty ? stamp : TenantDefaults.DefaultTenantId;
        return id.ToString("N");
    }

    public static bool IsDefault(string segment) => segment == TenantDefaults.DefaultTenantId.ToString("N");

    // True when the key (images/{segment}/... or images/legacy/...) belongs to the tenant with this segment.
    public static bool Owns(string key, string root, string segment)
    {
        var rest = RemoveRoot(key, root);
        if (rest is null)
        {
            return false;
        }

        var first = rest.Split('/', 2)[0];
        return TenantFolder().IsMatch(first)
            ? string.Equals(first, segment, StringComparison.OrdinalIgnoreCase)
            : IsDefault(segment);
    }

    // images/{tenant}/users/a.png -> images/users/a.png, so category settings keep working.
    public static string StripTenant(string key, string root)
    {
        var rest = RemoveRoot(key, root);
        if (rest is null)
        {
            return key;
        }

        var parts = rest.Split('/', 2);
        return TenantFolder().IsMatch(parts[0]) && parts.Length == 2 ? root + parts[1] : key;
    }

    private static string? RemoveRoot(string key, string root)
    {
        return key.StartsWith(root, StringComparison.OrdinalIgnoreCase) ? key[root.Length..] : null;
    }

    [GeneratedRegex("^[0-9a-fA-F]{32}$")]
    private static partial Regex TenantFolder();
}

public sealed class TenantImageStorage(IImageStorage inner, ICurrentTenant tenant) : IImageStorage
{
    private const string Root = "images/";

    private string Segment => TenantStorage.Segment(tenant);

    public Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken) =>
        inner.SaveAsync($"{Segment}/{category}", fileName, data, cancellationToken);

    public Task DeleteAsync(string? imageUrl, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(imageUrl) || !TenantStorage.Owns(inner.GetKey(imageUrl), Root, Segment))
        {
            return Task.CompletedTask;
        }

        return inner.DeleteAsync(imageUrl, cancellationToken);
    }

    public async Task<IReadOnlyList<StoredImageInfo>> ListAsync(CancellationToken cancellationToken)
    {
        var segment = Segment;
        return (await inner.ListAsync(cancellationToken))
            .Where(f => TenantStorage.Owns(f.Key, Root, segment))
            .ToList();
    }

    public string GetKey(string imageUrl) => inner.GetKey(imageUrl);
}

public sealed class TenantReportFileStorage(IReportFileStorage inner, ICurrentTenant tenant) : IReportFileStorage
{
    private string Segment => TenantStorage.Segment(tenant);

    public Task SaveAsync(string relativePath, byte[] data, string contentType, DateTimeOffset? generatedAtUtc, CancellationToken cancellationToken) =>
        inner.SaveAsync(Prefixed(relativePath), data, contentType, generatedAtUtc, cancellationToken);

    public async Task<byte[]?> ReadAllBytesAsync(string relativePath, CancellationToken cancellationToken)
    {
        var bytes = await inner.ReadAllBytesAsync(Prefixed(relativePath), cancellationToken);
        if (bytes is null && TenantStorage.IsDefault(Segment))
        {
            bytes = await inner.ReadAllBytesAsync(relativePath, cancellationToken);
        }

        return bytes;
    }

    public async Task<ReportFileInfo?> GetInfoAsync(string relativePath, CancellationToken cancellationToken)
    {
        var info = await inner.GetInfoAsync(Prefixed(relativePath), cancellationToken);
        if (info is null && TenantStorage.IsDefault(Segment))
        {
            info = await inner.GetInfoAsync(relativePath, cancellationToken);
        }

        return info is null ? null : info with { RelativePath = relativePath };
    }

    private string Prefixed(string relativePath) => $"{Segment}/{relativePath.Replace('\\', '/').TrimStart('/')}";
}

public sealed class TenantChatImageStore(IChatImageStore inner, ICurrentTenant tenant) : IChatImageStore
{
    private string Segment => TenantStorage.Segment(tenant);

    public Task SaveAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken) =>
        inner.SaveAsync(Prefixed(key), data, contentType, cancellationToken);

    public async Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken)
    {
        var bytes = await inner.ReadAsync(Prefixed(key), cancellationToken);
        if (bytes is null && TenantStorage.IsDefault(Segment))
        {
            bytes = await inner.ReadAsync(key, cancellationToken);
        }

        return bytes;
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        await inner.DeleteAsync(Prefixed(key), cancellationToken);
        if (TenantStorage.IsDefault(Segment))
        {
            await inner.DeleteAsync(key, cancellationToken);
        }
    }

    private string Prefixed(string key) => $"{Segment}/{key.Replace('\\', '/').TrimStart('/')}";
}
